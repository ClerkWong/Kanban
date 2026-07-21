"use client";

import { normalizeBaseUrl } from "../../sync/config";
import type { SyncHandle } from "../../sync/useSync";
import { useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

const statusText: Record<SyncHandle["status"], string> = {
  disabled: "未啟用",
  pending: "有變更待同步",
  syncing: "同步中…",
  synced: "已同步",
  error: "同步失敗",
};

export function SyncSettingsModal({
  sync,
  onClose,
  modalRef,
}: {
  sync: SyncHandle;
  onClose: () => void;
  modalRef: RefObject<HTMLDivElement | null>;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [initialMode, setInitialMode] = useState<"download" | "merge">("download");
  const [formError, setFormError] = useState("");

  async function submitEnable() {
    try {
      const normalized = normalizeBaseUrl(baseUrl);
      if (!token.trim()) {
        setFormError("請輸入 token。");
        return;
      }
      setFormError("");
      await sync.enable({ baseUrl: normalized, token: token.trim() }, initialMode);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "設定失敗，請再試一次。");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="syncTitle"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="modalHeader">
          <h2 id="syncTitle">雲端同步設定</h2>
          <button type="button" className="iconOnly" aria-label="關閉" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="syncStatusLine">
          目前狀態：{statusText[sync.status]}
          {sync.errorMessage && <span className="syncErrorText">（{sync.errorMessage}）</span>}
        </p>

        {sync.configured ? (
          <div className="syncActions">
            <button type="button" className="primaryButton" onClick={sync.syncNow}>
              立即同步
            </button>
            <button type="button" className="dangerGhost" onClick={sync.disable}>
              停用同步（保留本機資料）
            </button>
          </div>
        ) : (
          <div className="syncForm">
            <label className="formField">
              <span>同步伺服器網址</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://kanban-sync.example.workers.dev"
                autoFocus
              />
            </label>
            <label className="formField">
              <span>Token</span>
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <fieldset className="fieldGroup">
              <legend>首次同步資料來源</legend>
              <label className="syncModeChoice">
                <input
                  type="radio"
                  name="initialMode"
                  checked={initialMode === "download"}
                  onChange={() => setInitialMode("download")}
                />
                <span>以遠端為準（捨棄本機看板）</span>
              </label>
              <label className="syncModeChoice">
                <input
                  type="radio"
                  name="initialMode"
                  checked={initialMode === "merge"}
                  onChange={() => setInitialMode("merge")}
                />
                <span>合併本機與遠端</span>
              </label>
            </fieldset>
            {formError && (
              <p className="attachmentError" role="alert">
                {formError}
              </p>
            )}
            <div className="modalActions">
              <button type="button" className="secondaryButton" onClick={onClose}>
                取消
              </button>
              <button type="button" className="primaryButton" onClick={() => void submitEnable()}>
                啟用同步
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
