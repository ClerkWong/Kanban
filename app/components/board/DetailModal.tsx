"use client";

import { type AttachmentRef, type Label, type Priority, makeId } from "../../board-model";
import { type CardDraft, type DetailState, type StyleWithVars } from "./shared";
import { AttachmentSection } from "./AttachmentSection";
import type { BoardContext } from "../../projects/types";
import type { ProjectMember } from "../../projects/api";
import type { FormEvent, KeyboardEvent, RefObject } from "react";

export function DetailModal({
  detail,
  labels,
  modalRef,
  onClose,
  onDelete,
  onSubmit,
  onDraftChange,
  onAttachmentsChange,
  onCapabilityError,
  readOnly = false,
  attachmentsReadOnly = false,
  attachmentContext,
  projectMembers,
}: {
  detail: DetailState;
  labels: Label[];
  modalRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: CardDraft) => void;
  onAttachmentsChange: (next: AttachmentRef[]) => void;
  onCapabilityError: (error: unknown) => void;
  readOnly?: boolean;
  attachmentsReadOnly?: boolean;
  attachmentContext?: BoardContext;
  /** Undefined for a legacy local board; an array (including empty) for a Project board. */
  projectMembers?: ProjectMember[];
}) {
  const draft = detail.draft;
  const currentProjectMemberIds = new Set(
    projectMembers?.map((member) => member.userId) ?? [],
  );
  const departedAssigneeIds = draft.assigneeUserIds.filter(
    (userId) => !currentProjectMemberIds.has(userId),
  );

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

          <fieldset className="modalReadOnlyFields" disabled={readOnly}>
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

          <fieldset className={`fieldGroup blockerFields ${draft.blocked ? "active" : ""}`}>
            <legend>流動狀態</legend>
            <label className="blockedToggle">
              <input
                type="checkbox"
                checked={draft.blocked}
                onChange={(event) => setDraft({
                  blocked: event.target.checked,
                  blockedReason: event.target.checked ? draft.blockedReason : "",
                })}
              />
              <span>此任務目前卡住</span>
            </label>
            {draft.blocked && (
              <label className="formField" htmlFor="blockedReason">
                <span>卡住原因</span>
                <textarea
                  id="blockedReason"
                  aria-describedby="blockedReasonHint"
                  rows={3}
                  maxLength={500}
                  required
                  value={draft.blockedReason}
                  placeholder="例如：等待客戶確認 API 權限"
                  onChange={(event) => setDraft({ blockedReason: event.target.value })}
                />
              </label>
            )}
            {draft.blocked && (
              <small id="blockedReasonHint" className="fieldHint">
                解除卡住時，原因與卡住時間會一併清除。
              </small>
            )}
          </fieldset>

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

          {projectMembers === undefined ? (
            <label className="formField">
              <span>成員（以逗號分隔）</span>
              <input
                value={draft.members}
                onChange={(event) => setDraft({ members: event.target.value })}
                placeholder="雅婷, Kai"
              />
            </label>
          ) : (
            <>
              <fieldset className="fieldGroup">
                <legend>任務負責人（可複選）</legend>
                {projectMembers.length > 0 ? (
                  <div className="assigneeGrid">
                    {projectMembers.map((member) => (
                      <label className="assigneeChoice" key={member.userId}>
                        <input
                          type="checkbox"
                          checked={draft.assigneeUserIds.includes(member.userId)}
                          onChange={(event) =>
                            setDraft({
                              assigneeUserIds: event.target.checked
                                ? [...draft.assigneeUserIds, member.userId]
                                : draft.assigneeUserIds.filter(
                                    (userId) => userId !== member.userId,
                                  ),
                            })
                          }
                        />
                        <span>
                          <strong>{member.displayName}</strong>
                          <small>{projectRoleText(member.role)}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="fieldHint">目前沒有可指派的專案成員。</p>
                )}
                {departedAssigneeIds.map((userId) => (
                  <label className="assigneeChoice departed" key={userId}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setDraft({
                          assigneeUserIds: draft.assigneeUserIds.filter(
                            (candidate) => candidate !== userId,
                          ),
                        })
                      }
                    />
                    <span>
                      <strong>已離開專案的成員</strong>
                      <small>{userId}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {draft.members && (
                <label className="formField">
                  <span>舊版成員文字（不具指派功能）</span>
                  <input
                    value={draft.members}
                    onChange={(event) => setDraft({ members: event.target.value })}
                  />
                </label>
              )}
            </>
          )}
          </fieldset>

          <AttachmentSection
            attachments={draft.attachments}
            onChange={onAttachmentsChange}
            onError={onCapabilityError}
            readOnly={attachmentsReadOnly}
            context={attachmentContext}
          />

          <fieldset className="fieldGroup" disabled={readOnly}>
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
            {!readOnly && onDelete && (
              <button type="button" className="dangerButton" onClick={onDelete}>
                永久刪除
              </button>
            )}
            <span className="actionSpacer" />
            <button type="button" className="secondaryButton" onClick={onClose}>
              {readOnly ? "關閉" : "取消"}
            </button>
            {!readOnly && (
              <button type="submit" className="primaryButton">
                儲存
              </button>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}

function projectRoleText(role: ProjectMember["role"]): string {
  if (role === "owner") return "Project Owner";
  if (role === "member") return "Project Member";
  return "唯讀成員（舊版）";
}
