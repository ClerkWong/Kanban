import {
  BOARD_SCHEMA_VERSION,
  COLUMN_TITLE_MAX_LENGTH,
  DONE_COLUMN_ID,
  MAX_BOARD_COLUMNS,
  type BoardState,
  type Card,
  type Column,
  columnTitleKey,
  normalizeBoard,
} from "../board-model";

/** `obj[key]` 是原型鏈屬性查找：key 為 "constructor"／"__proto__" 等
 *  Object.prototype 上既有的名稱時一律 truthy，會把「這一側沒有這筆資料」
 *  誤判成「有」。這裡查的 cards／deletedCards 都是遠端 board JSON 內容，鍵
 *  可能是任意字串，必須用 Object.hasOwn 只認自身屬性。 */
function ownOrUndefined<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function mergeBoards(local: BoardState, remote: BoardState): BoardState {
  const localWins = (local.lastSavedAt || "") >= (remote.lastSavedAt || "");
  const winner = localWins ? local : remote;
  const loser = localWins ? remote : local;

  const deletedCards: Record<string, string> = { ...loser.deletedCards };
  for (const [cardId, deletedAt] of Object.entries(winner.deletedCards)) {
    const existing = ownOrUndefined(deletedCards, cardId);
    if (!existing || existing < deletedAt) {
      deletedCards[cardId] = deletedAt;
    }
  }

  const cards: Record<string, Card> = {};
  const cardSources: Record<string, BoardState> = {};
  const allIds = new Set([...Object.keys(local.cards), ...Object.keys(remote.cards)]);
  for (const cardId of allIds) {
    const mine = ownOrUndefined(local.cards, cardId);
    const theirs = ownOrUndefined(remote.cards, cardId);
    // updatedAt 平手時判給勝方（而非固定判給 local），確保兩台裝置以相反順序
    // 合併仍收斂到同一結果，位置不會在裝置間永久互推。
    const source =
      !mine ? remote
      : !theirs ? local
      : mine.updatedAt > theirs.updatedAt ? local
      : theirs.updatedAt > mine.updatedAt ? remote
      : winner;
    const candidate = ownOrUndefined(source.cards, cardId);
    // 防禦性檢查：cardId 保證是 local／remote 其中一方的自身鍵，且上面的
    // source 選擇邏輯保證選到確實擁有這張卡片的一側，candidate 理論上不會是
    // undefined——一旦失守（例如以上邏輯被改動而破壞這個保證），寧可跳過這張
    // 卡也不要把 undefined 寫進最終的 cards 表。
    if (!candidate) continue;
    const tombstone = ownOrUndefined(deletedCards, cardId);
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

  // 敗方獨有欄位不能默默丟棄：只要在敗方板上仍有卡片，同步 Worker 就會以
  // column_not_empty 拒絕缺少該欄的推送——即使卡片在合併後全被移走或刪除，
  // 欄位本身也必須保留（成為空欄，之後可正常刪除）。敗方板上已是空欄的
  // 獨有欄位視為勝方已刪除，不復活。欄位總數不得超過 MAX_BOARD_COLUMNS，
  // 超額的敗方獨有欄位不保留，其卡片回到勝方所在欄，兩側皆無處可放才落第一欄。
  const columns: Column[] = winner.columns.map((column) => ({ ...column, cardIds: [] }));
  const capacity = Math.max(0, MAX_BOARD_COLUMNS - columns.length);
  const loserOnlyColumns: Column[] = loser.columns
    .filter((column) => !winnerColumnIds.has(column.id) && column.cardIds.length > 0)
    .slice(0, capacity)
    .map((column) => ({ ...column, cardIds: [] }));
  const loserOnlyIds = new Set(loserOnlyColumns.map((column) => column.id));

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

  // 兩側可能各自新增同名欄位；Worker 對欄位標題有唯一性驗證，撞名的保留欄位
  // 需加後綴改名，避免合併結果被拒。
  const usedTitleKeys = new Set(
    columns
      .filter((column) => !loserOnlyIds.has(column.id))
      .map((column) => columnTitleKey(column.title)),
  );
  for (const column of columns) {
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
    columns,
    deletedCards,
    lastSavedAt: winner.lastSavedAt >= loser.lastSavedAt ? winner.lastSavedAt : loser.lastSavedAt,
    settings: winner.settings ?? loser.settings,
  });
}
