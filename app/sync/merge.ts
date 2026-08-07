import {
  BOARD_SCHEMA_VERSION,
  COLUMN_TITLE_MAX_LENGTH,
  DONE_COLUMN_ID,
  type BoardState,
  type Card,
  type Column,
  columnTitleKey,
  normalizeBoard,
} from "../board-model";

export function mergeBoards(local: BoardState, remote: BoardState): BoardState {
  const localWins = (local.lastSavedAt || "") >= (remote.lastSavedAt || "");
  const winner = localWins ? local : remote;
  const loser = localWins ? remote : local;

  const deletedCards: Record<string, string> = { ...loser.deletedCards };
  for (const [cardId, deletedAt] of Object.entries(winner.deletedCards)) {
    if (!deletedCards[cardId] || deletedCards[cardId] < deletedAt) {
      deletedCards[cardId] = deletedAt;
    }
  }

  const cards: Record<string, Card> = {};
  const cardSources: Record<string, BoardState> = {};
  const allIds = new Set([...Object.keys(local.cards), ...Object.keys(remote.cards)]);
  for (const cardId of allIds) {
    const mine = local.cards[cardId];
    const theirs = remote.cards[cardId];
    const source =
      !mine ? remote : !theirs ? local : mine.updatedAt >= theirs.updatedAt ? local : remote;
    const candidate = source.cards[cardId];
    const tombstone = deletedCards[cardId];
    if (tombstone && tombstone >= candidate.updatedAt) {
      continue;
    }
    if (tombstone) {
      delete deletedCards[cardId];
    }
    cards[cardId] = candidate;
    cardSources[cardId] = source;
  }

  const winnerColumnIds = new Set(winner.columns.map((column) => column.id));

  // 敗方獨有欄位不能默默丟棄：欄裡仍有卡片時必須保留，否則同步 Worker 會以
  // column_not_empty 拒絕後續推送。合併後仍為空的敗方獨有欄位視為勝方已刪除。
  const loserOnlyColumns: Column[] = loser.columns
    .filter((column) => !winnerColumnIds.has(column.id))
    .map((column) => ({ ...column, cardIds: [] }));
  const loserOnlyIds = new Set(loserOnlyColumns.map((column) => column.id));

  const columns: Column[] = winner.columns.map((column) => ({ ...column, cardIds: [] }));
  const doneIndex = columns.findIndex((column) => column.id === DONE_COLUMN_ID);
  columns.splice(doneIndex >= 0 ? doneIndex : columns.length, 0, ...loserOnlyColumns);
  const columnById = new Map(columns.map((column) => [column.id, column]));

  // 卡片位置跟隨卡片級 LWW：卡片放進其勝出版本所在的欄位。v7 起跨欄移動會
  // 更新 updatedAt，位置變更因此和其他欄位變更走同一套 LWW 規則。
  const placed = new Set<string>();
  const placeCard = (cardId: string, fallbackColumnId: string) => {
    if (placed.has(cardId)) return;
    const sourceColumnId = cardSources[cardId].columns.find((column) =>
      column.cardIds.includes(cardId),
    )?.id;
    const target =
      (sourceColumnId !== undefined ? columnById.get(sourceColumnId) : undefined) ??
      columnById.get(fallbackColumnId) ??
      columns[0];
    target.cardIds.push(cardId);
    placed.add(cardId);
  };

  for (const column of winner.columns) {
    for (const cardId of column.cardIds) {
      if (cards[cardId]) placeCard(cardId, column.id);
    }
  }
  for (const column of loser.columns) {
    for (const cardId of column.cardIds) {
      if (cards[cardId]) placeCard(cardId, column.id);
    }
  }
  for (const cardId of Object.keys(cards)) {
    if (!placed.has(cardId)) {
      columns[0].cardIds.push(cardId);
      placed.add(cardId);
    }
  }

  const doneColumn = columns.find((column) => column.id === DONE_COLUMN_ID);
  if (doneColumn) {
    const doneCardIds = new Set(doneColumn.cardIds);
    for (const cardId of Object.keys(cards)) {
      const isCompleted = cards[cardId].completedAt !== null;
      if (doneCardIds.has(cardId) === isCompleted) {
        continue;
      }

      if (isCompleted) {
        for (const column of columns) {
          column.cardIds = column.cardIds.filter((id) => id !== cardId);
        }
        doneColumn.cardIds.push(cardId);
        doneCardIds.add(cardId);
        continue;
      }

      doneColumn.cardIds = doneColumn.cardIds.filter((id) => id !== cardId);
      doneCardIds.delete(cardId);
      const sourceColumn = cardSources[cardId].columns.find(
        (column) => column.id !== DONE_COLUMN_ID && column.cardIds.includes(cardId),
      );
      const target =
        (sourceColumn && columns.find((column) => column.id === sourceColumn.id)) ??
        columns.find((column) => column.id !== DONE_COLUMN_ID) ??
        columns[0];
      target.cardIds.push(cardId);
    }
  }

  const survivingColumns = columns.filter(
    (column) => !loserOnlyIds.has(column.id) || column.cardIds.length > 0,
  );

  // 兩側可能各自新增同名欄位；Worker 對欄位標題有唯一性驗證，撞名的保留欄位
  // 需加後綴改名，避免合併結果被拒。
  const usedTitleKeys = new Set(
    survivingColumns
      .filter((column) => !loserOnlyIds.has(column.id))
      .map((column) => columnTitleKey(column.title)),
  );
  for (const column of survivingColumns) {
    if (!loserOnlyIds.has(column.id)) continue;
    let title = column.title;
    let counter = 2;
    while (usedTitleKeys.has(columnTitleKey(title))) {
      const suffix = `（${counter}）`;
      title = `${column.title.slice(0, COLUMN_TITLE_MAX_LENGTH - suffix.length)}${suffix}`;
      counter += 1;
    }
    column.title = title;
    usedTitleKeys.add(columnTitleKey(title));
  }

  return normalizeBoard({
    version: BOARD_SCHEMA_VERSION,
    labels: winner.labels,
    cards,
    columns: survivingColumns,
    deletedCards,
    lastSavedAt: winner.lastSavedAt >= loser.lastSavedAt ? winner.lastSavedAt : loser.lastSavedAt,
    settings: winner.settings ?? loser.settings,
  });
}
