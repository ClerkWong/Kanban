"use client";

import type { AttachmentRef } from "../../board-model";
import { usePlatform } from "../../platform/context";
import { makeId } from "../../board-model";
import { CapabilityError, MAX_ATTACHMENT_BYTES, base64ByteSize } from "../../platform/types";
import { cacheDownloadedAttachment } from "../../sync/attachment-api";
import { loadSyncConfig } from "../../sync/config";
import { useCallback, useEffect, useRef, useState } from "react";

export function AttachmentSection({
  attachments,
  onChange,
  onError,
  onDownload,
}: {
  attachments: AttachmentRef[];
  onChange: (next: AttachmentRef[]) => void;
  onError: (error: unknown) => void;
  onDownload?: (attachment: AttachmentRef) => Promise<boolean>;
}) {
  const platform = usePlatform();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const recordingRef = useRef(false);
  const sessionCreatedIds = useRef(new Set<string>());

  const downloadFromCurrentSync = useCallback(
    async (attachment: AttachmentRef): Promise<boolean> => {
      const config = loadSyncConfig();
      if (!config) {
        return false;
      }
      try {
        return cacheDownloadedAttachment(
          config,
          platform,
          attachment.fileName,
          attachment.mimeType,
          () => {
            const current = loadSyncConfig();
            return Boolean(
              current && current.baseUrl === config.baseUrl && current.token === config.token,
            );
          },
        );
      } catch {
        return false;
      }
    },
    [platform],
  );

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

  function ensureWithinLimit(base64Data: string): boolean {
    if (base64ByteSize(base64Data) <= MAX_ATTACHMENT_BYTES) {
      return true;
    }
    setErrorMessage("附件超過 10 MB 限制，請選擇較小的檔案或縮短錄音後再試。");
    return false;
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
      if (!ensureWithinLimit(capture.base64Data)) {
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
      if (!ensureWithinLimit(capture.base64Data)) {
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
              onDownload={onDownload ?? downloadFromCurrentSync}
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
  onDownload,
}: {
  attachment: AttachmentRef;
  armed: boolean;
  onRemoveClick: () => void;
  onResetArmed: () => void;
  onDownload?: (attachment: AttachmentRef) => Promise<boolean>;
}) {
  const platform = usePlatform();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const downloadAttempted = useRef(false);

  useEffect(() => {
    downloadAttempted.current = false;
  }, [attachment.fileName]);

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
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          if (onDownload && !downloadAttempted.current) {
            downloadAttempted.current = true;
            void onDownload(attachment).then((downloaded) => {
              if (!cancelled && downloaded) {
                setReloadKey((value) => value + 1);
              }
            });
          }
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [platform, attachment, attachment.fileName, attachment.mimeType, onDownload, reloadKey]);

  async function retryDownload() {
    if (onDownload && (await onDownload(attachment))) {
      setReloadKey((value) => value + 1);
    }
  }

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
      {failed && (
        <span className="attachmentError">
          附件載入失敗：未啟用同步、離線或遠端檔案不存在。
          {onDownload && (
            <button type="button" className="secondaryButton" onClick={() => void retryDownload()}>
              重新下載
            </button>
          )}
        </span>
      )}
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
