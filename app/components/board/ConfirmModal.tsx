"use client";

import type { ConfirmState } from "./shared";
import type { RefObject } from "react";

export function ConfirmModal({
  confirmAction,
  modalRef,
  onCancel,
  onConfirm,
}: {
  confirmAction: Exclude<ConfirmState, null>;
  modalRef: RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isReset = confirmAction.type === "reset";

  return (
    <div className="modalBackdrop" role="presentation">
      <div
        ref={modalRef}
        className="confirmModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmTitle"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
          }
        }}
      >
        <h2 id="confirmTitle">{isReset ? "重設示範資料？" : "永久刪除卡片？"}</h2>
        <p>
          {isReset
            ? "這會以內建示範資料取代目前本機看板。取消時不會變更任何資料。若已啟用雲端同步，重設結果也會同步給所有成員。"
            : `「${confirmAction.title}」會從本裝置永久刪除，這個 MVP 不使用封存或復原語意。`}
        </p>
        <div className="modalActions">
          <button type="button" className="secondaryButton" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="dangerButton" onClick={onConfirm}>
            {isReset ? "確認重設" : "確認刪除"}
          </button>
        </div>
      </div>
    </div>
  );
}
