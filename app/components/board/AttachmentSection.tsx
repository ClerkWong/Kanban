"use client";

import type { AttachmentRef } from "../../board-model";
import { usePlatform } from "../../platform/context";
import { makeId } from "../../board-model";
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

  async function addPhoto() {
    setBusy(true);
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
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (!recording) {
      try {
        await platform.audio.startRecording();
        updateRecording(true);
      } catch (error) {
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
      {attachments.length === 0 ? (
        <p className="attachmentEmpty">尚無附件</p>
      ) : (
        <ul className="attachmentList">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              onRemove={() => {
                onChange(attachments.filter((ref) => ref.id !== attachment.id));
                if (sessionCreatedIds.current.has(attachment.id)) {
                  sessionCreatedIds.current.delete(attachment.id);
                  void platform.attachments.remove(attachment.fileName).catch(() => {});
                }
              }}
            />
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function AttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: AttachmentRef;
  onRemove: () => void;
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
        className="iconOnly"
        aria-label={`移除附件 ${attachment.fileName}`}
        onClick={onRemove}
      >
        −
      </button>
    </li>
  );
}
