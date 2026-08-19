"use client";

import {
  type AttachmentRef,
  type Label,
  type Priority,
  type ServiceClass,
  makeId,
} from "../../board-model";
import {
  isImeComposing,
  type CardDraft,
  type DetailState,
  type StyleWithVars,
} from "./shared";
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
  canManageAssignments = true,
  attachmentContext,
  projectMembers,
  parentOptions,
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
  /** Project owner 專屬權限；false 時指派名單與投入期間唯讀（Worker 端同步以 403 擋下 member 的變更）。 */
  canManageAssignments?: boolean;
  attachmentContext?: BoardContext;
  /** Undefined for a legacy local board; an array (including empty) for a Project board. */
  projectMembers?: ProjectMember[];
  /** 可設為上層任務的候選卡片；由呼叫端以 eligibleParentCards（編輯模式）或全部卡片
   *  （新增模式）算好傳入，本元件不重新計算資格。 */
  parentOptions: Array<{ cardId: string; label: string }>;
}) {
  const draft = detail.draft;
  const currentProjectMemberIds = new Set(
    projectMembers?.map((member) => member.userId) ?? [],
  );
  const departedAssigneeIds = draft.assigneeUserIds.filter(
    (userId) => !currentProjectMemberIds.has(userId),
  );
  // 「投入期間」只列出目前已勾選的指派人（含已離開專案者）；順序與上方任務負責人
  // 清單一致——現職成員依 projectMembers 原順序，離職者附加在後。
  const assignmentRows: Array<{ userId: string; displayName: string | null }> = [
    ...(projectMembers ?? [])
      .filter((member) => draft.assigneeUserIds.includes(member.userId))
      .map((member) => ({ userId: member.userId, displayName: member.displayName })),
    ...departedAssigneeIds.map((userId) => ({ userId, displayName: null })),
  ];
  // 只要有一列「兩個日期都填了但結束日早於開始日」，就擋下送出——真正的丟棄
  // （未勾選者、兩個日期沒填齊者）留給 draftToCardInput／normalizeAssignmentWindows
  // 處理，這裡只擋「填了但範圍顛倒」這種會讓使用者以為存成功、實際上被 Worker
  // 400 或被靜默丟棄的情形。
  const hasInvalidAssignmentWindow = assignmentRows.some((row) => {
    const existingWindow = draft.assignmentWindows.find((entry) => entry.userId === row.userId);
    return Boolean(
      existingWindow &&
        existingWindow.startDate &&
        existingWindow.endDate &&
        existingWindow.endDate < existingWindow.startDate,
    );
  });

  function setDraft(patch: Partial<CardDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  /** 兩個日期都空時直接移除這筆 window，而不是留著一個兩個欄位都是空字串的殘影——
   * 這樣「該人視為未排期」在 draft 這一層就成立，不必等 draftToCardInput 才丟棄。 */
  function setAssignmentWindow(userId: string, next: { startDate: string; endDate: string }) {
    const others = draft.assignmentWindows.filter((entry) => entry.userId !== userId);
    if (!next.startDate && !next.endDate) {
      setDraft({ assignmentWindows: others });
      return;
    }
    setDraft({ assignmentWindows: [...others, { userId, ...next }] });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isImeComposing(event.nativeEvent)) {
      return;
    }
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
            <label className="formField">
              <span>服務類別</span>
              <select
                value={draft.serviceClass}
                onChange={(event) =>
                  setDraft({ serviceClass: event.target.value as ServiceClass })
                }
              >
                <option value="standard">標準</option>
                <option value="expedite">加急</option>
                <option value="fixedDate">固定日期</option>
                <option value="intangible">無形</option>
              </select>
            </label>
          </div>
          {draft.serviceClass === "fixedDate" && !draft.dueDate && (
            <small className="fieldHint">固定日期類別建議設定到期日，未設定仍可儲存。</small>
          )}

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
              <fieldset className="fieldGroup" disabled={readOnly || !canManageAssignments}>
                <legend>任務負責人（可複選）</legend>
                {!canManageAssignments && (
                  <p className="fieldHint">指派與排程由專案管理者負責。</p>
                )}
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

              <fieldset className="fieldGroup" disabled={readOnly || !canManageAssignments}>
                <legend>投入期間</legend>
                {!canManageAssignments && (
                  <p className="fieldHint">指派與排程由專案管理者負責。</p>
                )}
                {assignmentRows.length === 0 ? (
                  <p className="fieldHint">勾選任務負責人後，可在此設定每人的投入期間。</p>
                ) : (
                  assignmentRows.map((row) => {
                    const existingWindow = draft.assignmentWindows.find(
                      (entry) => entry.userId === row.userId,
                    );
                    const startDate = existingWindow?.startDate ?? "";
                    const endDate = existingWindow?.endDate ?? "";
                    const bothFilled = Boolean(startDate && endDate);
                    const invalidRange = bothFilled && endDate < startDate;
                    const name = row.displayName ?? `已離開專案的成員（${row.userId}）`;
                    return (
                      <div className="assignmentWindowRow" key={row.userId}>
                        <span>{name}</span>
                        <input
                          type="date"
                          aria-label={`${name} 投入開始日`}
                          value={startDate}
                          onChange={(event) =>
                            setAssignmentWindow(row.userId, {
                              startDate: event.target.value,
                              endDate,
                            })
                          }
                        />
                        <input
                          type="date"
                          aria-label={`${name} 投入結束日`}
                          value={endDate}
                          onChange={(event) =>
                            setAssignmentWindow(row.userId, {
                              startDate,
                              endDate: event.target.value,
                            })
                          }
                        />
                        {invalidRange ? (
                          <small className="assignmentWindowError" role="alert">
                            結束日不可早於開始日。
                          </small>
                        ) : !bothFilled ? (
                          <small className="fieldHint">兩個日期都填寫後才會排入甘特圖。</small>
                        ) : null}
                      </div>
                    );
                  })
                )}
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

          {/* 上層任務是工作內容的組織方式，與清單、標籤同一層，不是指派——刻意不受
              canManageAssignments 影響（那個旗標只管指派名單與投入期間），member
              也能改。readOnly（整卡唯讀，如封存看板或 viewer）時才 disabled。 */}
          <label className="formField parentTaskField" htmlFor="parentCardId">
            <span>上層任務</span>
            <select
              id="parentCardId"
              aria-describedby="parentCardIdHint"
              value={draft.parentCardId ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                setDraft({
                  parentCardId: event.target.value === "" ? null : event.target.value,
                })
              }
            >
              <option value="">（不設上層任務）</option>
              {parentOptions.map((option) => (
                <option key={option.cardId} value={option.cardId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <small id="parentCardIdHint" className="fieldHint">
            上層任務只表示工作的歸屬，不影響完成狀態。
          </small>
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
              <button
                type="submit"
                className="primaryButton"
                disabled={hasInvalidAssignmentWindow}
              >
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
