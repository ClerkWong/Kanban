"use client";

import {
  type Filters,
  STORAGE_KEY,
  addCard,
  createDemoBoard,
  deleteCard,
  diffAttachmentRefs,
  filterCards,
  getBoardStats,
  getColumnWip,
  getLocalDateString,
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
} from "../../board-model";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CardItem } from "./CardItem";
import { ConfirmModal } from "./ConfirmModal";
import { DetailModal } from "./DetailModal";
import { usePlatform } from "../../platform/context";
import { CapabilityError } from "../../platform/types";
import {
  type ConfirmState,
  type DetailState,
  createDraft,
  draftFromCard,
  draftToCardInput,
  emptyFilters,
  findNearestFocus,
  locateCard,
} from "./shared";

export function BoardApp({
  enableServiceWorker = false,
}: {
  enableServiceWorker?: boolean;
}) {
  const [board, setBoard] = useState(() => createDemoBoard());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const modalRef = useRef<HTMLDivElement>(null);

  const platform = usePlatform();
  const [capabilityMessage, setCapabilityMessage] = useState("");

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

  const today = useMemo(() => getLocalDateString(), []);
  const filtersActive = isFilterActive(filters);
  const visibleCards = useMemo(
    () => filterCards(board, filters, today),
    [board, filters, today],
  );
  const stats = useMemo(() => getBoardStats(board, today), [board, today]);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = parsePersistedBoard(window.localStorage.getItem(STORAGE_KEY));
      setBoard(stored.board);
      if (stored.error) {
        setStorageMessage(stored.error);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, serializeBoard(board));
    } catch {
      queueMicrotask(() => {
        setStorageMessage("儲存失敗：資料目前可能只在這個分頁可見。");
      });
    }
  }, [board, loaded]);

  useEffect(() => {
    if (!enableServiceWorker) {
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        setStorageMessage("離線快取啟用失敗；本機資料仍會保存在此瀏覽器。");
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
    if (detail || confirmAction) {
      modalRef.current?.focus();
    } else if (restoreFocusId) {
      window.requestAnimationFrame(() => {
        cardRefs.current.get(restoreFocusId)?.focus();
        setRestoreFocusId(null);
      });
    }
  }, [detail, confirmAction, restoreFocusId]);

  function openAdd(columnId: string) {
    setRestoreFocusId(null);
    setDetail({ mode: "add", columnId, draft: createDraft() });
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
    if (!detail) {
      return;
    }

    const input = draftToCardInput(detail.draft);
    const { removed } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
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
    const title = board.cards[cardId]?.title ?? "這張卡片";
    if (detail) {
      const { added } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
      removeAttachmentFiles(added);
    }
    setDetail(null);
    setConfirmAction({ type: "delete", cardId, title });
  }

  function confirmDelete(cardId: string) {
    const title = board.cards[cardId]?.title ?? "卡片";
    const position = findNearestFocus(board.columns, cardId);
    removeAttachmentFiles(board.cards[cardId]?.attachments ?? []);
    setBoard((current) => deleteCard(current, cardId));
    setPendingFocusId(position);
    setLiveMessage(`已永久刪除「${title}」。`);
    setConfirmAction(null);
  }

  function confirmReset() {
    removeAttachmentFiles(Object.values(board.cards).flatMap((card) => card.attachments));
    setBoard(createDemoBoard());
    setFilters(emptyFilters);
    setDetail(null);
    setConfirmAction(null);
    setLiveMessage("已重設為示範資料。");
  }

  function moveWithButtons(cardId: string, direction: "up" | "down" | "left" | "right") {
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
    if (!draggedCardId || filtersActive) {
      return;
    }

    setBoard((current) => moveCard(current, draggedCardId, columnId, targetIndex));
    setPendingFocusId(draggedCardId);
    setLiveMessage("已移動卡片。");
    setDraggedCardId(null);
  }

  const noVisibleCards =
    board.columns.reduce((count, column) => count + visibleCards[column.id].length, 0) === 0;

  return (
    <main className="appShell">
      <section className="topBar" aria-label="看板摘要">
        <div className="brandBlock">
          <p className="eyebrow">本機優先 Kanban PWA</p>
          <h1>本機 Kanban 看板</h1>
          <p className="storageNote">資料只保存在本裝置/瀏覽器，離線後仍可使用核心流程。</p>
        </div>

        <div className="statsGrid" aria-label="看板統計">
          <Stat label="總工作" value={stats.total} />
          <Stat label="進行中" value={stats.active} />
          <Stat label="完成" value={stats.completed} />
          <Stat label="逾期" value={stats.overdue} tone={stats.overdue ? "danger" : "ok"} />
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
        <button type="button" className="secondaryButton" onClick={() => setFilters(emptyFilters)}>
          清除
        </button>
        <button type="button" className="dangerGhost" onClick={() => setConfirmAction({ type: "reset" })}>
          重設示範資料
        </button>
      </section>

      {(filtersActive || storageMessage || capabilityMessage) && (
        <section className="noticeStack" aria-live="polite">
          {filtersActive && (
            <p className="notice">
              搜尋/篩選啟用中，已暫停拖曳、移動與重排，避免破壞原始排序。清除條件後即可調整順序。
            </p>
          )}
          {storageMessage && <p className="notice warning">{storageMessage}</p>}
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
                if (!filtersActive) {
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
                {wip.limit !== null && (
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
                      onOpen={() => openEdit(card.id)}
                      onMove={(direction) => moveWithButtons(card.id, direction)}
                      onChecklistToggle={(itemId) =>
                        setBoard((current) => toggleChecklistItem(current, card.id, itemId))
                      }
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

              <button type="button" className="addCardButton" onClick={() => openAdd(column.id)}>
                ＋ 新增卡片
              </button>
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
          onDraftChange={(draft) => setDetail({ ...detail, draft } as DetailState)}
          onCapabilityError={reportCapabilityError}
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
