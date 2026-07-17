"use client";

import { type Label, type Priority, makeId } from "../../board-model";
import { type CardDraft, type DetailState, type StyleWithVars } from "./shared";
import { AttachmentSection } from "./AttachmentSection";
import type { FormEvent, KeyboardEvent, RefObject } from "react";

export function DetailModal({
  detail,
  labels,
  modalRef,
  onClose,
  onDelete,
  onSubmit,
  onDraftChange,
  onCapabilityError,
}: {
  detail: DetailState;
  labels: Label[];
  modalRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: CardDraft) => void;
  onCapabilityError: (error: unknown) => void;
}) {
  const draft = detail.draft;

  function setDraft(patch: Partial<CardDraft>) {
    onDraftChange({ ...draft, ...patch });
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
        aria-labelledby="detailTitle"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <form onSubmit={onSubmit}>
          <header className="modalHeader">
            <h2 id="detailTitle">{detail.mode === "add" ? "新增卡片" : "卡片詳情"}</h2>
            <button type="button" className="iconOnly" aria-label="關閉" onClick={onClose}>
              ×
            </button>
          </header>

          <label className="formField">
            <span>標題</span>
            <input
              required
              value={draft.title}
              onChange={(event) => setDraft({ title: event.target.value })}
              autoFocus
            />
          </label>

          <label className="formField">
            <span>描述</span>
            <textarea
              rows={4}
              value={draft.description}
              onChange={(event) => setDraft({ description: event.target.value })}
            />
          </label>

          <div className="formGrid">
            <label className="formField">
              <span>優先級</span>
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ priority: event.target.value as Priority })}
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label className="formField">
              <span>到期日</span>
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => setDraft({ dueDate: event.target.value })}
              />
            </label>
          </div>

          <fieldset className="fieldGroup">
            <legend>標籤</legend>
            <div className="checkboxGrid">
              {labels.map((label) => (
                <label key={label.id} className="tagChoice">
                  <input
                    type="checkbox"
                    checked={draft.labelIds.includes(label.id)}
                    onChange={(event) =>
                      setDraft({
                        labelIds: event.target.checked
                          ? [...draft.labelIds, label.id]
                          : draft.labelIds.filter((id) => id !== label.id),
                      })
                    }
                  />
                  <span style={{ "--label": label.color } as StyleWithVars}>{label.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="formField">
            <span>成員（以逗號分隔）</span>
            <input
              value={draft.members}
              onChange={(event) => setDraft({ members: event.target.value })}
              placeholder="雅婷, Kai"
            />
          </label>

          <AttachmentSection
            attachments={draft.attachments}
            onChange={(attachments) => setDraft({ attachments })}
            onError={onCapabilityError}
          />

          <fieldset className="fieldGroup">
            <legend>清單</legend>
            <div className="checklistEditor">
              {draft.checklist.map((item, index) => (
                <div key={item.id} className="checkEditorRow">
                  <input
                    aria-label={`清單 ${index + 1} 完成狀態`}
                    type="checkbox"
                    checked={item.done}
                    onChange={(event) =>
                      setDraft({
                        checklist: draft.checklist.map((entry) =>
                          entry.id === item.id ? { ...entry, done: event.target.checked } : entry,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`清單 ${index + 1} 內容`}
                    value={item.text}
                    onChange={(event) =>
                      setDraft({
                        checklist: draft.checklist.map((entry) =>
                          entry.id === item.id ? { ...entry, text: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="iconOnly"
                    aria-label="移除清單項目"
                    onClick={() =>
                      setDraft({
                        checklist: draft.checklist.filter((entry) => entry.id !== item.id),
                      })
                    }
                  >
                    −
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondaryButton"
              onClick={() =>
                setDraft({
                  checklist: [
                    ...draft.checklist,
                    { id: makeId("check"), text: "新的待辦項目", done: false },
                  ],
                })
              }
            >
              ＋ 新增清單項目
            </button>
          </fieldset>

          <footer className="modalActions">
            {onDelete && (
              <button type="button" className="dangerButton" onClick={onDelete}>
                永久刪除
              </button>
            )}
            <span className="actionSpacer" />
            <button type="button" className="secondaryButton" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primaryButton">
              儲存
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
