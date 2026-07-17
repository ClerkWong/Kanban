"use client";

import type { AttachmentRef } from "../../board-model";
import { usePlatform } from "../../platform/context";
import { makeId } from "../../board-model";
import { CapabilityError } from "../../platform/types";
import { useEffect, useRef, useState } from "react";

export function AttachmentSection({
  attachments,
  onChange,
  onError,
}: {
  attachments: AttachmentRef[];
  onChange: (next: AttachmentRef[]) => void;
  onError: (error: unknown) => void;
}) {
  const platform = usePlatform();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const recordingRef = useRef(false);
  const sessionCreatedIds = useRef(new Set<string>());

  function updateRecording(next: boolean) {
    recordingRef.current = next;
    setRecording(next);
  }

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        void platform.audio.stopRecording().catch(() => {});
      }
    };
  }, [platform]);

  function performRemove(attachment: AttachmentRef) {
    onChange(attachments.filter((ref) => ref.id !== attachment.id));
    if (sessionCreatedIds.current.has(attachment.id)) {
      sessionCreatedIds.current.delete(attachment.id);
      void platform.attachments.remove(attachment.fileName).catch(() => {});
    }
    setConfirmingRemoveId(null);
  }

  function handleRemoveClick(attachment: AttachmentRef) {
    if (confirmingRemoveId === attachment.id) {
      performRemove(attachment);
    } else {
      setConfirmingRemoveId(attachment.id);
    }
  }

  async function addPhoto() {
    setConfirmingRemoveId(null);
    setBusy(true);
    setErrorMessage("");
    try {
      const capture = await platform.takePhoto();
      if (!capture) {
        return;
      }
      const id = makeId("att");
      const saved = await platform.attachments.save(id, capture);
      sessionCreatedIds.current.add(id);
      onChange([
        ...attachments,
        {
          id,
          type: "photo",
          fileName: saved.fileName,
          mimeType: capture.mimeType,
          size: saved.size,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      setErrorMessage(
        error instanceof CapabilityError ? error.message : "操作失敗，請再試一次。",
      );
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    setConfirmingRemoveId(null);
    setErrorMessage("");
    if (!recording) {
      try {
        await platform.audio.startRecording();
        updateRecording(true);
      } catch (error) {
        setErrorMessage(
          error instanceof CapabilityError ? error.message : "操作失敗，請再試一次。",
        );
        onError(error);
      }
      return;
    }

    updateRecording(false);
    setBusy(true);
    try {
      const capture = await platform.audio.stopRecording();
      if (!capture) {
        return;
      }
      const id = makeId("att");
      const saved = await platform.attachments.save(id, capture);
      sessionCreatedIds.current.add(id);
      onChange([
        ...attachments,
        {
          id,
          type: "audio",
          fileName: saved.fileName,
          mimeType: capture.mimeType,
          size: saved.size,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      setErrorMessage(
        error instanceof CapabilityError ? error.message : "操作失敗，請再試一次。",
      );
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="fieldGroup">
      <legend>附件</legend>
      <div className="attachmentActions">
        <button type="button" className="secondaryButton" disabled={busy || recording} onClick={addPhoto}>
          ＋ 照片
        </button>
        <button
          type="button"
          className={`secondaryButton ${recording ? "recordingActive" : ""}`}
          aria-pressed={recording}
          disabled={busy}
          onClick={toggleRecording}
        >
          {recording ? "■ 停止錄音" : "● 錄音"}
        </button>
        {recording && (
          <span className="recordingHint" aria-live="polite">
            錄音中…再按一次完成
          </span>
        )}
      </div>
      {errorMessage && (
        <p className="attachmentError" role="alert">
          {errorMessage}
        </p>
      )}
      {attachments.length === 0 ? (
        <p className="attachmentEmpty">尚無附件</p>
      ) : (
        <ul className="attachmentList">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              armed={confirmingRemoveId === attachment.id}
              onRemoveClick={() => handleRemoveClick(attachment)}
              onResetArmed={() =>
                setConfirmingRemoveId((current) => (current === attachment.id ? null : current))
              }
            />
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function AttachmentItem({
  attachment,
  armed,
  onRemoveClick,
  onResetArmed,
}: {
  attachment: AttachmentRef;
  armed: boolean;
  onRemoveClick: () => void;
  onResetArmed: () => void;
}) {
  const platform = usePlatform();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    platform.attachments
      .loadAsUrl(attachment.fileName, attachment.mimeType)
      .then((value) => {
        if (cancelled) {
          if (value.startsWith("blob:")) {
            URL.revokeObjectURL(value);
          }
          return;
        }
        objectUrl = value;
        setUrl(value);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [platform, attachment.fileName, attachment.mimeType]);

  return (
    <li className="attachmentItem">
      {attachment.type === "photo" ? (
        url ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob/data URL 縮圖無法用 next/image
          <img className="attachmentThumb" src={url} alt={`照片附件 ${attachment.fileName}`} />
        ) : (
          <span className="attachmentThumb attachmentPending" aria-hidden="true" />
        )
      ) : url ? (
        <audio className="attachmentAudio" controls src={url} aria-label={`錄音附件 ${attachment.fileName}`} />
      ) : (
        <span className="attachmentPending">載入中…</span>
      )}
      {failed && <span className="attachmentError">附件載入失敗</span>}
      <button
        type="button"
        className={armed ? "iconOnly attachmentRemoveArmed" : "iconOnly"}
        aria-label={armed ? "確認移除" : `移除附件 ${attachment.fileName}`}
        onClick={onRemoveClick}
        onBlur={onResetArmed}
      >
        {armed ? "確認移除" : "−"}
      </button>
    </li>
  );
}
