"use client";

import { normalizeBaseUrl } from "../../sync/config";
import type { SyncHandle } from "../../sync/useSync";
import { isImeComposing } from "./shared";
import { useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";

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
    if (isImeComposing(event.nativeEvent)) {
      return;
    }
    if (event.key === "Escape") {
      onClose();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitEnable();
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <div
        ref={modalRef}
        className="modal syncSettingsModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="syncTitle"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="modalHeader syncSettingsHeader">
          <div>
            <p className="modalEyebrow">跨裝置同步</p>
            <h2 id="syncTitle">雲端同步設定</h2>
          </div>
          <button type="button" className="iconOnly" aria-label="關閉" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="syncSettingsContent">
          <section className={`syncStatusPanel syncStatus-${sync.status}`} aria-label="同步狀態">
            <span className="syncStatusIndicator" aria-hidden="true" />
            <div className="syncStatusCopy">
              <span>目前狀態</span>
              <strong>{statusText[sync.status]}</strong>
              {sync.session && <small>使用者：{sync.session.user.displayName}</small>}
              {sync.errorMessage && (
                <small className="syncErrorText" role="alert">
                  {sync.errorMessage}
                </small>
              )}
            </div>
          </section>

          {sync.configured ? (
            <div className="syncConfiguredPanel">
              <div>
                <h3>同步已設定完成</h3>
                <p>你可以立即同步最新變更，或停用同步並保留這台裝置上的資料。</p>
              </div>
              <div className="syncActions">
                <button type="button" className="primaryButton" onClick={sync.syncNow}>
                  立即同步
                </button>
                <button type="button" className="dangerGhost" onClick={sync.disable}>
                  停用同步
                </button>
              </div>
            </div>
          ) : (
            <form className="syncForm" onSubmit={onSubmit}>
              <div className="syncFieldSection">
                <label className="formField">
                  <span>同步伺服器網址</span>
                  <input
                    type="url"
                    inputMode="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://kanban-sync.example.workers.dev"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    required
                  />
                </label>
                <label className="formField">
                  <span>個人 Token</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="貼上你的個人 token"
                    required
                  />
                </label>
                <p className="syncPrivacyNote">
                  Token 只會安全保存在這台裝置，用來識別你可存取的專案。
                </p>
              </div>

              <fieldset className="fieldGroup syncModeGroup">
                <legend>首次同步資料來源</legend>
                <p className="syncModeIntro">
                  個人 token 會直接進入「我的專案」。只有舊版 shared legacy token
                  需要選擇以下處理方式。
                </p>
                <label className="syncModeChoice">
                  <input
                    type="radio"
                    name="initialMode"
                    checked={initialMode === "download"}
                    onChange={() => setInitialMode("download")}
                  />
                  <span className="syncModeText">
                    <strong>使用雲端資料</strong>
                    <small>捨棄這台裝置的舊看板，以遠端資料開始。</small>
                  </span>
                </label>
                <label className="syncModeChoice">
                  <input
                    type="radio"
                    name="initialMode"
                    checked={initialMode === "merge"}
                    onChange={() => setInitialMode("merge")}
                  />
                  <span className="syncModeText">
                    <strong>合併本機資料</strong>
                    <small>保留本機看板，並與遠端資料合併。</small>
                  </span>
                </label>
              </fieldset>

              {formError && (
                <p className="attachmentError syncFormError" role="alert">
                  {formError}
                </p>
              )}
              <div className="modalActions syncModalActions">
                <button type="button" className="secondaryButton" onClick={onClose}>
                  取消
                </button>
                <button type="submit" className="primaryButton">
                  啟用同步
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
