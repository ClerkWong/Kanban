"use client";

import {
  type Filters,
  STORAGE_KEY,
  UNASSIGNED_FILTER_VALUE,
  addCard,
  createDemoBoard,
  deleteCard,
  diffAttachmentRefs,
  filterCards,
  getBoardStats,
  getColumnWip,
  getLocalDateString,
  getMonthlyCompletionStats,
  isFilterActive,
  makeId,
  moveCard,
  moveCardRelative,
  parsePersistedBoard,
  serializeBoard,
  toggleChecklistItem,
  updateCard,
  updateWipLimit,
  type AttachmentRef,
  type BoardState,
} from "../../board-model";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  FormEvent,
  ReactNode,
  SetStateAction,
} from "react";
import { CardItem } from "./CardItem";
import { ConfirmModal } from "./ConfirmModal";
import { DetailModal } from "./DetailModal";
import { MonthlyReportModal } from "./MonthlyReportModal";
import { SyncSettingsModal } from "./SyncSettingsModal";
import { VoiceCaptureButton } from "./VoiceCaptureButton";
import { usePlatform } from "../../platform/context";
import { CapabilityError } from "../../platform/types";
import { useSync } from "../../sync/useSync";
import type { SyncHandle } from "../../sync/useSync";
import { useBoardSync, type BoardSyncHandle } from "../../sync/useBoardSync";
import { useBoardStore } from "../../projects/useBoardStore";
import type { BoardContext } from "../../projects/types";
import type { ProjectMember } from "../../projects/api";
import type { BoardAccess } from "../../projects/navigation";
import {
  type ConfirmState,
  type DetailState,
  createDraft,
  draftFromCard,
  draftToCardInput,
  emptyFilters,
  findNearestFocus,
  getBoardOverlayKey,
  locateCard,
} from "./shared";
import { bundledAppConfig, loadAppConfig } from "../../app-config";

export function BoardApp({
  enableServiceWorker = false,
  appConfigUrl = "/app-config.json",
  context,
  projectName,
  access,
  navigation,
  projectMembers,
}: {
  enableServiceWorker?: boolean;
  appConfigUrl?: string;
  context?: BoardContext;
  projectName?: string;
  access?: BoardAccess;
  navigation?: ReactNode;
  projectMembers?: ProjectMember[];
}) {
  return context ? (
    <ScopedBoardApp
      context={context}
      projectName={projectName}
      access={access}
      navigation={navigation}
      projectMembers={projectMembers ?? []}
      enableServiceWorker={enableServiceWorker}
      appConfigUrl={appConfigUrl}
    />
  ) : (
    <LegacyBoardApp
      enableServiceWorker={enableServiceWorker}
      appConfigUrl={appConfigUrl}
    />
  );
}

function LegacyBoardApp({
  enableServiceWorker,
  appConfigUrl,
}: {
  enableServiceWorker: boolean;
  appConfigUrl: string;
}) {
  const [board, setBoard] = useState(() => createDemoBoard());
  const [loaded, setLoaded] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const sync = useSync(board, setBoard, loaded);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = parsePersistedBoard(window.localStorage.getItem(STORAGE_KEY));
      setBoard(stored.board);
      if (stored.error) setStorageMessage(stored.error);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeBoard(board));
    } catch {
      queueMicrotask(() => {
        setStorageMessage("儲存失敗：資料目前可能只在這個分頁可見。");
      });
    }
  }, [board, loaded]);

  return (
    <BoardSurface
      board={board}
      setBoard={setBoard}
      sync={sync}
      storageMessage={storageMessage}
      access={{ canEdit: true, canWriteAttachments: true, readOnlyReason: null }}
      enableServiceWorker={enableServiceWorker}
      appConfigUrl={appConfigUrl}
      showSyncSettings
    />
  );
}

function ScopedBoardApp({
  context,
  projectName,
  access = { canEdit: false, canWriteAttachments: false, readOnlyReason: "唯讀模式。" },
  navigation,
  projectMembers,
  enableServiceWorker,
  appConfigUrl,
}: {
  context: BoardContext;
  projectName?: string;
  access?: BoardAccess;
  navigation?: ReactNode;
  projectMembers: ProjectMember[];
  enableServiceWorker: boolean;
  appConfigUrl: string;
}) {
  const store = useBoardStore(context.boardId);
  const sync = useBoardSync(
    context,
    store.board,
    store.setBoard,
    store.loaded,
    !access.canEdit,
  );
  return (
    <BoardSurface
      board={store.board}
      setBoard={store.setBoard}
      sync={sync}
      storageMessage={store.errorMessage}
      access={access}
      context={context}
      projectName={projectName}
      projectMembers={projectMembers}
      navigation={navigation}
      enableServiceWorker={enableServiceWorker}
      appConfigUrl={appConfigUrl}
    />
  );
}

function BoardSurface({
  board,
  setBoard,
  sync,
  storageMessage,
  access,
  context,
  projectName,
  projectMembers,
  navigation,
  enableServiceWorker,
  appConfigUrl,
  showSyncSettings = false,
}: {
  board: BoardState;
  setBoard: Dispatch<SetStateAction<BoardState>>;
  sync: SyncHandle | BoardSyncHandle;
  storageMessage: string;
  access: BoardAccess;
  context?: BoardContext;
  projectName?: string;
  projectMembers?: ProjectMember[];
  navigation?: ReactNode;
  enableServiceWorker: boolean;
  appConfigUrl: string;
  showSyncSettings?: boolean;
}) {
  const [appTitle, setAppTitle] = useState(bundledAppConfig.title);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [runtimeStorageMessage, setRuntimeStorageMessage] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const modalRef = useRef<HTMLDivElement>(null);

  const platform = usePlatform();
  const [capabilityMessage, setCapabilityMessage] = useState("");
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const activeOverlay = getBoardOverlayKey({
    detail,
    confirmAction,
    syncOpen: syncModalOpen,
    reportOpen,
  });

  useEffect(() => {
    let cancelled = false;

    void loadAppConfig(appConfigUrl).then((config) => {
      if (!cancelled) {
        setAppTitle(config.title);
        document.title = config.title;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appConfigUrl]);

  useEffect(() => {
    let cancelled = false;
    platform.speech
      .available()
      .then((available) => {
        if (!cancelled) {
          setSpeechAvailable(available);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [platform]);

  function reportCapabilityError(error: unknown) {
    setCapabilityMessage(
      error instanceof CapabilityError ? error.message : "操作失敗，請再試一次。",
    );
  }

  function removeAttachmentFiles(refs: AttachmentRef[]) {
    for (const ref of refs) {
      void platform.attachments.remove(ref.fileName).catch(() => {});
    }
  }

  function detailOriginalAttachments(current: DetailState): AttachmentRef[] {
    return current.mode === "edit" ? (board.cards[current.cardId]?.attachments ?? []) : [];
  }

  function applyAttachmentsChange(current: DetailState, next: AttachmentRef[]) {
    if (!access.canEdit || !access.canWriteAttachments) return;
    setDetail((existing) =>
      existing ? { ...existing, draft: { ...existing.draft, attachments: next } } : existing,
    );
    if (current.mode === "edit") {
      const card = board.cards[current.cardId];
      if (card) {
        const { added, removed } = diffAttachmentRefs(card.attachments, next);
        sync.queueUploads(added);
        sync.queueDeletes(removed);
        removeAttachmentFiles(removed);
        setBoard((currentBoard) => updateCard(currentBoard, current.cardId, { attachments: next }));
      }
    }
  }

  const today = useMemo(() => getLocalDateString(), []);
  const filtersActive = isFilterActive(filters);
  const visibleCards = useMemo(
    () => filterCards(board, filters, today),
    [board, filters, today],
  );
  const stats = useMemo(() => getBoardStats(board, today), [board, today]);
  const assigneeNames = useMemo(
    () => projectMembers === undefined
      ? undefined
      : Object.fromEntries(
          projectMembers.map((member) => [member.userId, member.displayName]),
        ),
    [projectMembers],
  );

  useEffect(() => {
    if (!enableServiceWorker) {
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        setRuntimeStorageMessage("離線快取啟用失敗；本機資料仍會保存在此瀏覽器。");
      });
    }
  }, [enableServiceWorker]);

  useEffect(() => {
    if (pendingFocusId) {
      window.requestAnimationFrame(() => {
        cardRefs.current.get(pendingFocusId)?.focus();
        setPendingFocusId(null);
      });
    }
  }, [board, pendingFocusId]);

  useEffect(() => {
    if (activeOverlay) {
      const modal = modalRef.current;
      if (modal && !modal.contains(document.activeElement)) {
        modal.focus();
      }
    } else if (restoreFocusId) {
      window.requestAnimationFrame(() => {
        cardRefs.current.get(restoreFocusId)?.focus();
        setRestoreFocusId(null);
      });
    }
  }, [activeOverlay, restoreFocusId]);

  function openAdd(columnId: string) {
    if (!access.canEdit) return;
    setRestoreFocusId(null);
    setDetail({ mode: "add", columnId, draft: createDraft() });
  }

  function openAddWithTitle(columnId: string, title: string) {
    if (!access.canEdit) return;
    setRestoreFocusId(null);
    setDetail({ mode: "add", columnId, draft: { ...createDraft(), title } });
    setLiveMessage(`已辨識語音，請確認卡片內容後儲存。`);
  }

  function openEdit(cardId: string) {
    const card = board.cards[cardId];
    if (!card) {
      return;
    }
    setRestoreFocusId(cardId);
    setDetail({ mode: "edit", cardId, draft: draftFromCard(card) });
  }

  function closeOverlays() {
    if (detail) {
      const { added } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
      removeAttachmentFiles(added);
    }
    setDetail(null);
    setConfirmAction(null);
  }

  function saveDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !access.canEdit) {
      return;
    }

    const input = draftToCardInput(detail.draft);
    if (!input.title.trim()) {
      setLiveMessage("標題不可為空白，請輸入標題後再儲存。");
      return;
    }
    if (input.blocked && !input.blockedReason) {
      setLiveMessage("請填寫卡住原因後再儲存。");
      return;
    }

    const { added, removed } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
    if (detail.mode === "edit") {
      sync.queueUploads(added);
      sync.queueDeletes(removed);
    }
    removeAttachmentFiles(removed);
    if (detail.mode === "add") {
      const nextId = makeId("card");
      setBoard((current) =>
        addCard(current, detail.columnId, {
          ...input,
          id: nextId,
          title: input.title,
        }),
      );
      sync.queueUploads(input.attachments);
      setPendingFocusId(nextId);
      setLiveMessage(`已新增「${input.title}」。`);
    } else {
      setBoard((current) => updateCard(current, detail.cardId, input));
      setPendingFocusId(detail.cardId);
      setLiveMessage(`已更新「${input.title}」。`);
    }
    setDetail(null);
  }

  function requestDelete(cardId: string) {
    if (!access.canEdit) return;
    const title = board.cards[cardId]?.title ?? "這張卡片";
    if (detail) {
      const { added } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
      removeAttachmentFiles(added);
    }
    setDetail(null);
    setConfirmAction({ type: "delete", cardId, title });
  }

  function confirmDelete(cardId: string) {
    if (!access.canEdit) return;
    const title = board.cards[cardId]?.title ?? "卡片";
    const position = findNearestFocus(board.columns, cardId);
    const attachments = board.cards[cardId]?.attachments ?? [];
    sync.queueDeletes(attachments);
    removeAttachmentFiles(attachments);
    setBoard((current) => deleteCard(current, cardId));
    setPendingFocusId(position);
    setLiveMessage(`已永久刪除「${title}」。`);
    setConfirmAction(null);
  }

  function confirmReset() {
    if (!access.canEdit) return;
    const attachments = Object.values(board.cards).flatMap((card) => card.attachments);
    sync.queueDeletes(attachments);
    removeAttachmentFiles(attachments);
    setBoard(createDemoBoard());
    setFilters(emptyFilters);
    setDetail(null);
    setConfirmAction(null);
    setLiveMessage("已重設為示範資料。");
  }

  function moveWithButtons(cardId: string, direction: "up" | "down" | "left" | "right") {
    if (!access.canEdit) return;
    if (filtersActive) {
      setLiveMessage("搜尋或篩選中已暫停移動與排序，請先清除條件。");
      return;
    }

    const before = locateCard(board, cardId);
    const next = moveCardRelative(board, cardId, direction);
    const after = locateCard(next, cardId);
    setBoard(next);
    setPendingFocusId(cardId);
    if (before && after) {
      setLiveMessage(
        `已將「${next.cards[cardId].title}」移到${next.columns[after.columnIndex].title}第 ${
          after.cardIndex + 1
        } 張。`,
      );
    }
  }

  function dropCard(columnId: string, targetIndex: number) {
    if (!access.canEdit || !draggedCardId || filtersActive) {
      return;
    }

    setBoard((current) => moveCard(current, draggedCardId, columnId, targetIndex));
    setPendingFocusId(draggedCardId);
    setLiveMessage("已移動卡片。");
    setDraggedCardId(null);
  }

  const noVisibleCards =
    board.columns.reduce((count, column) => count + visibleCards[column.id].length, 0) === 0;
  const currentUserId = sync.session?.user.id ?? "";
  const onlyMeActive = Boolean(currentUserId && filters.assigneeUserId === currentUserId);

  return (
    <main className="appShell">
      {navigation}
      <section className="topBar" aria-label="看板摘要">
        <div className="brandBlock">
          <p className="eyebrow">本機優先 Kanban PWA</p>
          <h1>{projectName ?? appTitle}</h1>
          <p className="storageNote">資料先保存在本裝置；啟用同步後可跨裝置共用，離線仍可使用核心流程。</p>
        </div>

        <div className="statsGrid" aria-label="看板統計">
          <Stat label="總工作" value={stats.total} />
          <Stat label="進行中" value={stats.active} />
          <Stat label="完成" value={stats.completed} />
          <Stat label="逾期" value={stats.overdue} tone={stats.overdue ? "danger" : "ok"} />
        </div>

        <div className="topBarActions">
          <button
            type="button"
            className="syncPill"
            onClick={() => setReportOpen(true)}
            aria-label="開啟每月完成報表"
          >
            📊 報表
          </button>
          <button
            type="button"
            className={`syncPill ${sync.status}`}
            onClick={() => {
              if (showSyncSettings) setSyncModalOpen(true);
              else sync.syncNow();
            }}
            aria-label={showSyncSettings ? "開啟雲端同步設定" : "立即同步此看板"}
          >
            {sync.status === "disabled" && "同步：未啟用"}
            {sync.status === "pending" && "同步：待同步"}
            {sync.status === "syncing" && "同步中…"}
            {sync.status === "synced" && "同步：已同步"}
            {sync.status === "error" && "同步：失敗"}
          </button>
        </div>
      </section>

      <section className="toolBand" aria-label="搜尋與篩選">
        <label className="searchField">
          <span>搜尋</span>
          <input
            type="search"
            value={filters.query}
            placeholder="搜尋標題或描述"
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <label>
          <span>標籤</span>
          <select
            value={filters.labelId}
            onChange={(event) => setFilters({ ...filters, labelId: event.target.value })}
          >
            <option value="">全部標籤</option>
            {board.labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>優先級</span>
          <select
            value={filters.priority}
            onChange={(event) =>
              setFilters({ ...filters, priority: event.target.value as Filters["priority"] })
            }
          >
            <option value="all">全部</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </label>
        <label>
          <span>到期</span>
          <select
            value={filters.due}
            onChange={(event) => setFilters({ ...filters, due: event.target.value as Filters["due"] })}
          >
            <option value="all">全部</option>
            <option value="overdue">已逾期</option>
            <option value="today">今天</option>
            <option value="upcoming">未來</option>
            <option value="none">未設定</option>
          </select>
        </label>
        {projectMembers !== undefined && (
          <label>
            <span>負責人</span>
            <select
              value={filters.assigneeUserId}
              onChange={(event) => setFilters({ ...filters, assigneeUserId: event.target.value })}
            >
              <option value="">全部</option>
              <option value={UNASSIGNED_FILTER_VALUE}>未指派</option>
              {projectMembers.map((member) => (
                <option value={member.userId} key={member.userId}>{member.displayName}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>流動狀態</span>
          <select
            value={filters.blocked}
            onChange={(event) => setFilters({
              ...filters,
              blocked: event.target.value as Filters["blocked"],
            })}
          >
            <option value="all">全部</option>
            <option value="blocked">已卡住</option>
            <option value="unblocked">未卡住</option>
          </select>
        </label>
        <button type="button" className="secondaryButton" onClick={() => setFilters(emptyFilters)}>
          清除
        </button>
        {projectMembers !== undefined && (
          <button
            type="button"
            className={onlyMeActive ? "filterToggle active" : "filterToggle"}
            aria-pressed={onlyMeActive}
            disabled={!currentUserId}
            onClick={() => setFilters({
              ...filters,
              assigneeUserId: onlyMeActive ? "" : currentUserId,
            })}
          >
            {onlyMeActive ? "取消只看我" : "只看我"}
          </button>
        )}
        {access.canEdit && (
          <button type="button" className="dangerGhost" onClick={() => setConfirmAction({ type: "reset" })}>
            重設示範資料
          </button>
        )}
      </section>

      {(filtersActive || storageMessage || runtimeStorageMessage || capabilityMessage ||
        sync.status === "error" || access.readOnlyReason) && (
        <section className="noticeStack" aria-live="polite">
          {access.readOnlyReason && <p className="notice readOnlyNotice">{access.readOnlyReason}</p>}
          {filtersActive && (
            <p className="notice">
              搜尋/篩選啟用中，已暫停拖曳、移動與重排，避免破壞原始排序。清除條件後即可調整順序。
            </p>
          )}
          {storageMessage && <p className="notice warning">{storageMessage}</p>}
          {runtimeStorageMessage && <p className="notice warning">{runtimeStorageMessage}</p>}
          {capabilityMessage && (
            <p className="notice warning">
              {capabilityMessage}
              <button
                type="button"
                className="iconOnly"
                aria-label="關閉訊息"
                onClick={() => setCapabilityMessage("")}
              >
                ×
              </button>
            </p>
          )}
          {sync.status === "error" && sync.errorMessage && (
            <p className="notice warning">
              {sync.errorMessage}
              <button type="button" className="secondaryButton" onClick={sync.syncNow}>
                重試
              </button>
            </p>
          )}
        </section>
      )}

      <p className="srOnly" aria-live="polite">
        {liveMessage}
      </p>

      <section className="board" aria-label="Kanban 看板">
        {board.columns.map((column) => {
          const wip = getColumnWip(column);
          const cards = visibleCards[column.id];

          return (
            <article
              key={column.id}
              className={`column ${wip.reached ? "wipReached" : ""}`}
              onDragOver={(event) => {
                if (access.canEdit && !filtersActive) {
                  event.preventDefault();
                }
              }}
              onDrop={() => dropCard(column.id, column.cardIds.length)}
            >
              <header className="columnHeader">
                <div>
                  <h2>{column.title}</h2>
                  {wip.limit === null ? (
                    <p className="columnMeta">{column.cardIds.length} 張，完成欄不設 WIP</p>
                  ) : (
                    <p className="columnMeta">
                      WIP {wip.count}/{wip.limit}
                      {wip.reached ? "，已達上限" : ""}
                    </p>
                  )}
                </div>
                {wip.limit !== null && access.canEdit && (
                  <label className="wipInput">
                    <span>上限</span>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={wip.limit}
                      onChange={(event) =>
                        setBoard((current) =>
                          updateWipLimit(current, column.id, Number(event.target.value)),
                        )
                      }
                    />
                  </label>
                )}
              </header>

              <div className="cardList">
                {cards.length === 0 ? (
                  <div className="emptyState">
                    {filtersActive ? "此欄沒有符合條件的卡片" : "目前沒有卡片"}
                  </div>
                ) : (
                  cards.map((card, index) => (
                    <CardItem
                      key={card.id}
                      card={card}
                      labels={board.labels}
                      today={today}
                      movementDisabled={filtersActive}
                      assigneeNames={assigneeNames}
                      readOnly={!access.canEdit}
                      onOpen={() => openEdit(card.id)}
                      onMove={(direction) => moveWithButtons(card.id, direction)}
                      onChecklistToggle={(itemId) => {
                        if (access.canEdit) {
                          setBoard((current) => toggleChecklistItem(current, card.id, itemId));
                        }
                      }}
                      setRef={(node) => {
                        if (node) {
                          cardRefs.current.set(card.id, node);
                        } else {
                          cardRefs.current.delete(card.id);
                        }
                      }}
                      onDragStart={() => setDraggedCardId(card.id)}
                      onDragEnd={() => setDraggedCardId(null)}
                      onDropBefore={() => dropCard(column.id, index)}
                    />
                  ))
                )}
              </div>

              {access.canEdit && (
                <div className="addCardRow">
                  <button type="button" className="addCardButton" onClick={() => openAdd(column.id)}>
                    ＋ 新增卡片
                  </button>
                  {speechAvailable && (
                    <VoiceCaptureButton
                      columnTitle={column.title}
                      onResult={(text) => openAddWithTitle(column.id, text)}
                      onError={reportCapabilityError}
                    />
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {noVisibleCards && filtersActive && (
        <p className="noResults">沒有符合目前搜尋與篩選條件的卡片。</p>
      )}

      {detail && (
        <DetailModal
          detail={detail}
          labels={board.labels}
          modalRef={modalRef}
          onClose={closeOverlays}
          onDelete={detail.mode === "edit" ? () => requestDelete(detail.cardId) : undefined}
          onSubmit={saveDetail}
          onDraftChange={(draft) => setDetail((current) => (current ? { ...current, draft } : current))}
          onAttachmentsChange={(next) => applyAttachmentsChange(detail, next)}
          onCapabilityError={reportCapabilityError}
          readOnly={!access.canEdit}
          attachmentsReadOnly={!access.canWriteAttachments}
          attachmentContext={context}
          projectMembers={projectMembers}
        />
      )}

      {syncModalOpen && showSyncSettings && "enable" in sync && (
        <SyncSettingsModal sync={sync} modalRef={modalRef} onClose={() => setSyncModalOpen(false)} />
      )}

      {reportOpen && (
        <MonthlyReportModal
          stats={getMonthlyCompletionStats(board)}
          labels={board.labels}
          modalRef={modalRef}
          onClose={() => setReportOpen(false)}
        />
      )}

      {confirmAction && (
        <ConfirmModal
          confirmAction={confirmAction}
          modalRef={modalRef}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() =>
            confirmAction.type === "reset"
              ? confirmReset()
              : confirmDelete(confirmAction.cardId)
          }
        />
      )}

      {!platform.isNative && (
        <footer className="appFooter">
          <a href="/privacy">隱私說明</a>
          <a href="/support">支援</a>
        </footer>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "ok" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
