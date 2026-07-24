export const BOARD_SCHEMA_VERSION = 4;

export type Priority = "low" | "medium" | "high";
export type DueFilter = "all" | "overdue" | "today" | "upcoming" | "none";

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type AttachmentType = "photo" | "audio";

export type AttachmentRef = {
  id: string;
  type: AttachmentType;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type Card = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  labelIds: string[];
  dueDate: string;
  checklist: ChecklistItem[];
  members: string[];
  attachments: AttachmentRef[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Column = {
  id: string;
  title: string;
  wipLimit: number | null;
  cardIds: string[];
};

export type Label = {
  id: string;
  name: string;
  color: string;
};

export type BoardState = {
  version: typeof BOARD_SCHEMA_VERSION;
  columns: Column[];
  cards: Record<string, Card>;
  labels: Label[];
  deletedCards: Record<string, string>;
  lastSavedAt: string;
};

export type Filters = {
  query: string;
  labelId: string;
  priority: "all" | Priority;
  due: DueFilter;
};

export type BoardStats = {
  total: number;
  active: number;
  completed: number;
  overdue: number;
};

export const STORAGE_KEY = "kanban-pwa-board-v1";
export const DONE_COLUMN_ID = "done";
export const TOMBSTONE_TTL_DAYS = 30;

const STARTER_LABELS: Label[] = [
  { id: "strategy", name: "策略", color: "#5b7cfa" },
  { id: "research", name: "研究", color: "#0f9f8f" },
  { id: "customer", name: "客戶", color: "#d46b08" },
  { id: "ops", name: "營運", color: "#7a4cc2" },
  { id: "content", name: "內容", color: "#c24164" },
];

export function createDemoBoard(now = new Date()): BoardState {
  const today = getLocalDateString(now);
  const tomorrow = offsetDate(today, 1);
  const nextWeek = offsetDate(today, 7);
  const yesterday = offsetDate(today, -1);

  const cards: Record<string, Card> = {
    "card-roadmap": createSeedCard({
      id: "card-roadmap",
      title: "整理第三季產品路線圖",
      description:
        "彙整訪談、營收假設與技術風險，準備週五下午的優先級討論。",
      priority: "high",
      labelIds: ["strategy", "research"],
      dueDate: today,
      members: ["雅婷", "Kai"],
      checklist: [
        ["訪談摘要去重", true],
        ["補上影響/信心分數", false],
        ["列出暫緩項目", false],
      ],
    }),
    "card-onboarding": createSeedCard({
      id: "card-onboarding",
      title: "新客戶導入清單改版",
      description:
        "把客服常見漏項轉成可勾選步驟，降低第一次導入時的來回確認。",
      priority: "medium",
      labelIds: ["customer", "ops"],
      dueDate: nextWeek,
      members: ["Mina"],
      checklist: [
        ["盤點最近十筆導入問題", true],
        ["草擬新版清單", true],
        ["請客服主管確認", false],
      ],
    }),
    "card-analytics": createSeedCard({
      id: "card-analytics",
      title: "看板指標口徑確認",
      description:
        "確認 active work、完成數與逾期數如何從 canonical board state 推導。",
      priority: "high",
      labelIds: ["strategy"],
      dueDate: tomorrow,
      members: ["Leo"],
      checklist: [
        ["定義完成欄例外", true],
        ["補上 WIP 到達上限規則", true],
        ["寫進驗收備註", false],
      ],
    }),
    "card-copy": createSeedCard({
      id: "card-copy",
      title: "首頁微文案繁中修整",
      description:
        "把功能說明改成更像工作現場會出現的語氣，避免翻譯腔。",
      priority: "low",
      labelIds: ["content"],
      dueDate: "",
      members: ["雅婷"],
      checklist: [
        ["列出主要 CTA", true],
        ["修正空狀態文字", false],
      ],
    }),
    "card-review": createSeedCard({
      id: "card-review",
      title: "付款流程風險審核",
      description:
        "法務與財務正在確認退款條款，完成後才能進入發布前檢查。",
      priority: "medium",
      labelIds: ["customer", "ops"],
      dueDate: yesterday,
      members: ["Kai", "Nora"],
      checklist: [
        ["整理現行條款", true],
        ["標出需要法務回覆的段落", true],
        ["同步財務窗口", false],
      ],
    }),
    "card-done": createSeedCard({
      id: "card-done",
      title: "完成週會決議紀錄",
      description:
        "已寄給專案成員，並把後續行動拆成卡片放回看板。",
      priority: "low",
      labelIds: ["ops"],
      dueDate: yesterday,
      members: ["Mina"],
      checklist: [
        ["整理錄音重點", true],
        ["寄出摘要", true],
      ],
    }),
  };

  return {
    version: BOARD_SCHEMA_VERSION,
    labels: STARTER_LABELS,
    cards,
    deletedCards: {},
    columns: [
      {
        id: "todo",
        title: "待辦",
        wipLimit: 5,
        cardIds: ["card-roadmap", "card-onboarding"],
      },
      {
        id: "doing",
        title: "進行中",
        wipLimit: 3,
        cardIds: ["card-analytics", "card-copy"],
      },
      {
        id: "review",
        title: "審核中",
        wipLimit: 2,
        cardIds: ["card-review"],
      },
      {
        id: DONE_COLUMN_ID,
        title: "完成",
        wipLimit: null,
        cardIds: ["card-done"],
      },
    ],
    lastSavedAt: new Date().toISOString(),
  };
}

export function makeId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function offsetDate(dateOnly: string, offsetDays: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const local = new Date(year, month - 1, day + offsetDays);
  return getLocalDateString(local);
}

export function isFilterActive(filters: Filters): boolean {
  return Boolean(
    filters.query.trim() ||
      filters.labelId ||
      filters.priority !== "all" ||
      filters.due !== "all",
  );
}

export function getBoardStats(
  board: BoardState,
  today = getLocalDateString(),
): BoardStats {
  const doneIds = new Set(
    board.columns.find((column) => column.id === DONE_COLUMN_ID)?.cardIds ?? [],
  );
  const cards = Object.values(board.cards);

  return {
    total: cards.length,
    active: cards.filter((card) => !doneIds.has(card.id)).length,
    completed: doneIds.size,
    overdue: cards.filter(
      (card) => card.dueDate && card.dueDate < today && !doneIds.has(card.id),
    ).length,
  };
}

export function getColumnWip(column: Column): {
  count: number;
  limit: number | null;
  reached: boolean;
} {
  if (column.wipLimit === null) {
    return { count: column.cardIds.length, limit: null, reached: false };
  }

  return {
    count: column.cardIds.length,
    limit: column.wipLimit,
    reached: column.cardIds.length >= column.wipLimit,
  };
}

export function filterCards(
  board: BoardState,
  filters: Filters,
  today = getLocalDateString(),
): Record<string, Card[]> {
  const query = filters.query.trim().toLocaleLowerCase("zh-Hant");
  const result: Record<string, Card[]> = {};
  const doneIds = new Set(
    board.columns.find((column) => column.id === DONE_COLUMN_ID)?.cardIds ?? [],
  );

  for (const column of board.columns) {
    result[column.id] = column.cardIds
      .map((cardId) => board.cards[cardId])
      .filter(Boolean)
      .filter((card) => {
        const textMatches =
          !query ||
          `${card.title} ${card.description}`
            .toLocaleLowerCase("zh-Hant")
            .includes(query);
        const labelMatches =
          !filters.labelId || card.labelIds.includes(filters.labelId);
        const priorityMatches =
          filters.priority === "all" || card.priority === filters.priority;
        const dueMatches = matchesDueFilter(card, filters.due, today, doneIds);

        return textMatches && labelMatches && priorityMatches && dueMatches;
      });
  }

  return result;
}

export function addCard(
  board: BoardState,
  columnId: string,
  input: Partial<Card> & Pick<Card, "title">,
): BoardState {
  const id = input.id ?? makeId("card");
  const now = new Date().toISOString();
  const card: Card = {
    id,
    title: input.title.trim(),
    description: input.description ?? "",
    priority: input.priority ?? "medium",
    labelIds: uniqueStrings(input.labelIds ?? []),
    dueDate: normalizeDateOnly(input.dueDate ?? ""),
    checklist: normalizeChecklist(input.checklist ?? []),
    members: uniqueStrings(input.members ?? []),
    attachments: normalizeAttachments(input.attachments ?? []),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    completedAt:
      columnId === DONE_COLUMN_ID
        ? normalizeTimestamp(input.completedAt) ?? now
        : null,
  };

  if (!card.title) {
    return board;
  }

  const next = cloneBoard(board);
  next.cards[id] = card;
  if (next.deletedCards[id]) {
    const cleaned = { ...next.deletedCards };
    delete cleaned[id];
    next.deletedCards = cleaned;
  }
  next.columns = next.columns.map((column) =>
    column.id === columnId
      ? { ...column, cardIds: [...column.cardIds, id] }
      : column,
  );
  return normalizeBoard(touch(next));
}

export function updateCard(
  board: BoardState,
  cardId: string,
  patch: Partial<Omit<Card, "id" | "createdAt">>,
): BoardState {
  const existing = board.cards[cardId];
  if (!existing) {
    return board;
  }

  const title = patch.title === undefined ? existing.title : patch.title.trim();
  if (!title) {
    return board;
  }

  const next = cloneBoard(board);
  next.cards[cardId] = {
    ...existing,
    ...patch,
    title,
    labelIds: uniqueStrings(patch.labelIds ?? existing.labelIds),
    dueDate: normalizeDateOnly(patch.dueDate ?? existing.dueDate),
    checklist: normalizeChecklist(patch.checklist ?? existing.checklist),
    members: uniqueStrings(patch.members ?? existing.members),
    attachments: normalizeAttachments(patch.attachments ?? existing.attachments),
    updatedAt: new Date().toISOString(),
  };

  return normalizeBoard(touch(next));
}

export function deleteCard(board: BoardState, cardId: string): BoardState {
  if (!board.cards[cardId]) {
    return board;
  }

  const next = cloneBoard(board);
  delete next.cards[cardId];
  next.deletedCards = { ...next.deletedCards, [cardId]: new Date().toISOString() };
  next.columns = next.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId),
  }));
  return normalizeBoard(touch(next));
}

export function moveCard(
  board: BoardState,
  cardId: string,
  targetColumnId: string,
  targetIndex: number,
  now = new Date(),
): BoardState {
  if (!board.cards[cardId] || !board.columns.some((c) => c.id === targetColumnId)) {
    return board;
  }

  const next = cloneBoard(board);
  const sourceColumnId = findCardPosition(board, cardId)?.columnIndex;
  const sourceIsDone =
    sourceColumnId !== undefined && board.columns[sourceColumnId]?.id === DONE_COLUMN_ID;
  const targetIsDone = targetColumnId === DONE_COLUMN_ID;
  next.columns = next.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId),
  }));

  next.columns = next.columns.map((column) => {
    if (column.id !== targetColumnId) {
      return column;
    }

    const insertionIndex = clamp(targetIndex, 0, column.cardIds.length);
    const cardIds = [...column.cardIds];
    cardIds.splice(insertionIndex, 0, cardId);
    return { ...column, cardIds };
  });

  if (sourceIsDone !== targetIsDone) {
    const timestamp = normalizeTimestamp(now) ?? new Date().toISOString();
    next.cards[cardId] = {
      ...next.cards[cardId],
      completedAt: targetIsDone ? timestamp : null,
      updatedAt: timestamp,
    };
  }

  return normalizeBoard(touch(next, now));
}

export function moveCardRelative(
  board: BoardState,
  cardId: string,
  direction: "up" | "down" | "left" | "right",
): BoardState {
  const position = findCardPosition(board, cardId);
  if (!position) {
    return board;
  }

  const { columnIndex, cardIndex } = position;
  const source = board.columns[columnIndex];

  if (direction === "up") {
    return moveCard(board, cardId, source.id, cardIndex - 1);
  }
  if (direction === "down") {
    return moveCard(board, cardId, source.id, cardIndex + 1);
  }

  const targetColumnIndex =
    direction === "left" ? columnIndex - 1 : columnIndex + 1;
  const target = board.columns[targetColumnIndex];
  if (!target) {
    return board;
  }

  return moveCard(board, cardId, target.id, Math.min(cardIndex, target.cardIds.length));
}

export function updateWipLimit(
  board: BoardState,
  columnId: string,
  limit: number | null,
): BoardState {
  const next = cloneBoard(board);
  next.columns = next.columns.map((column) => {
    if (column.id !== columnId || column.id === DONE_COLUMN_ID) {
      return column;
    }

    return {
      ...column,
      wipLimit:
        limit === null ? null : clamp(Math.round(Number(limit) || 1), 1, 99),
    };
  });
  return normalizeBoard(touch(next));
}

export function toggleChecklistItem(
  board: BoardState,
  cardId: string,
  itemId: string,
): BoardState {
  const card = board.cards[cardId];
  if (!card) {
    return board;
  }

  return updateCard(board, cardId, {
    checklist: card.checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    ),
  });
}

export function serializeBoard(board: BoardState): string {
  return JSON.stringify(normalizeBoard(board));
}

export function parsePersistedBoard(raw: string | null): {
  board: BoardState;
  recovered: boolean;
  error: string | null;
} {
  if (!raw) {
    return { board: createDemoBoard(), recovered: false, error: null };
  }

  try {
    const parsed = JSON.parse(raw);
    const version = (parsed as { version?: unknown }).version;
    if (
      !isBoardLike(parsed) ||
      (version !== 1 && version !== 2 && version !== 3 && version !== BOARD_SCHEMA_VERSION)
    ) {
      return {
        board: createDemoBoard(),
        recovered: true,
        error: "本機資料版本不相容，已載入示範資料。",
      };
    }

    return {
      board: normalizeBoard(parsed),
      recovered: false,
      error: null,
    };
  } catch {
    return {
      board: createDemoBoard(),
      recovered: true,
      error: "偵測到本機資料格式異常，已載入示範資料。",
    };
  }
}

export function normalizeBoard(board: BoardState): BoardState {
  const labels = Array.isArray(board.labels) ? board.labels : STARTER_LABELS;
  const cards = normalizeCards(board.cards);
  const columns = normalizeColumns(board.columns, cards);
  const sourceVersion = Number(board.version);
  const isLegacyBoard = sourceVersion >= 1 && sourceVersion < BOARD_SCHEMA_VERSION;

  if (isLegacyBoard) {
    const doneCardIds = new Set(
      columns.find((column) => column.id === DONE_COLUMN_ID)?.cardIds ?? [],
    );
    for (const card of Object.values(cards)) {
      // v1–v3 did not record completion time. This one-time migration uses the
      // last edit time only for cards already in Done, so historic months are estimates.
      card.completedAt = doneCardIds.has(card.id)
        ? normalizeTimestamp(card.updatedAt)
        : null;
    }
  }
  const assigned = new Set(columns.flatMap((column) => column.cardIds));
  const firstColumn = columns[0];

  for (const cardId of Object.keys(cards)) {
    if (!assigned.has(cardId)) {
      firstColumn.cardIds.push(cardId);
      assigned.add(cardId);
    }
  }

  return {
    version: BOARD_SCHEMA_VERSION,
    labels,
    cards,
    deletedCards: normalizeDeletedCards(board.deletedCards, cards),
    columns,
    lastSavedAt: board.lastSavedAt || new Date().toISOString(),
  };
}

export function assertBoardInvariants(board: BoardState): void {
  const allColumnIds = board.columns.flatMap((column) => column.cardIds);
  const uniqueColumnIds = new Set(allColumnIds);
  const cardIds = Object.keys(board.cards);

  if (uniqueColumnIds.size !== allColumnIds.length) {
    throw new Error("Card order contains duplicate IDs.");
  }
  if (uniqueColumnIds.size !== cardIds.length) {
    throw new Error("Each card must belong to exactly one column.");
  }
  for (const cardId of cardIds) {
    if (!uniqueColumnIds.has(cardId)) {
      throw new Error(`Card ${cardId} is missing from columns.`);
    }
  }
}

export function diffAttachmentRefs(
  before: AttachmentRef[],
  after: AttachmentRef[],
): { added: AttachmentRef[]; removed: AttachmentRef[] } {
  const beforeIds = new Set(before.map((ref) => ref.id));
  const afterIds = new Set(after.map((ref) => ref.id));
  return {
    added: after.filter((ref) => !beforeIds.has(ref.id)),
    removed: before.filter((ref) => !afterIds.has(ref.id)),
  };
}

export type MonthlyCompletion = {
  month: string;
  monthLabel: string;
  count: number;
  cards: Card[];
};

export function getMonthlyCompletionStats(
  board: BoardState,
  recentMonths = 6,
  now = new Date(),
): MonthlyCompletion[] {
  const monthCount = Math.max(0, Math.floor(recentMonths));
  const referenceDate = toValidDate(now);
  if (!monthCount || !referenceDate) {
    return [];
  }

  const doneColumn = board.columns.find((column) => column.id === DONE_COLUMN_ID);
  const doneCards = (doneColumn?.cardIds ?? [])
    .map((id) => board.cards[id])
    .filter((card): card is Card => card != null);

  const groups = new Map<string, Card[]>();
  for (const card of doneCards) {
    const completedAt = toValidDate(card.completedAt);
    if (!completedAt) {
      continue;
    }
    const month = getLocalMonthKey(completedAt);
    const list = groups.get(month);
    if (list) {
      list.push(card);
    } else {
      groups.set(month, [card]);
    }
  }

  return getRecentMonthKeys(referenceDate, monthCount).map((month) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const cards = groups.get(month) ?? [];
    return {
      month,
      monthLabel: `${year} 年 ${monthNumber} 月`,
      count: cards.length,
      cards: [...cards].sort((a, b) =>
        (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
      ),
    };
  });
}

function createSeedCard(input: {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  labelIds: string[];
  dueDate: string;
  members: string[];
  checklist: Array<[string, boolean]>;
}): Card {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    priority: input.priority,
    labelIds: input.labelIds,
    dueDate: input.dueDate,
    members: input.members,
    attachments: [],
    checklist: input.checklist.map(([text, done], index) => ({
      id: `${input.id}-check-${index + 1}`,
      text,
      done,
    })),
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    completedAt: input.id === "card-done" ? "2026-07-01T09:00:00.000Z" : null,
  };
}

function matchesDueFilter(
  card: Card,
  due: DueFilter,
  today: string,
  doneIds: Set<string>,
): boolean {
  if (due === "all") {
    return true;
  }
  if (due === "none") {
    return !card.dueDate;
  }
  if (!card.dueDate) {
    return false;
  }
  if (due === "overdue") {
    return card.dueDate < today && !doneIds.has(card.id);
  }
  if (due === "today") {
    return card.dueDate === today;
  }
  return card.dueDate > today;
}

function findCardPosition(
  board: BoardState,
  cardId: string,
): { columnIndex: number; cardIndex: number } | null {
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const cardIndex = board.columns[columnIndex].cardIds.indexOf(cardId);
    if (cardIndex >= 0) {
      return { columnIndex, cardIndex };
    }
  }
  return null;
}

function normalizeColumns(columns: Column[], cards: Record<string, Card>): Column[] {
  const seen = new Set<string>();
  const source = Array.isArray(columns) && columns.length ? columns : createDemoBoard().columns;

  return source.map((column, index) => {
    const id = typeof column.id === "string" && column.id ? column.id : `column-${index}`;
    const cardIds = Array.isArray(column.cardIds)
      ? column.cardIds.filter((cardId) => {
          if (typeof cardId !== "string" || !cards[cardId] || seen.has(cardId)) {
            return false;
          }
          seen.add(cardId);
          return true;
        })
      : [];

    return {
      id,
      title: typeof column.title === "string" && column.title ? column.title : "未命名",
      wipLimit: id === DONE_COLUMN_ID ? null : normalizeWipLimit(column.wipLimit),
      cardIds,
    };
  });
}

function normalizeCards(cards: Record<string, Card>): Record<string, Card> {
  const normalized: Record<string, Card> = {};
  if (!cards || typeof cards !== "object") {
    return normalized;
  }

  for (const [cardId, raw] of Object.entries(cards)) {
    if (!raw || typeof raw !== "object" || typeof raw.title !== "string") {
      continue;
    }

    normalized[cardId] = {
      id: cardId,
      title: raw.title.trim() || "未命名卡片",
      description: typeof raw.description === "string" ? raw.description : "",
      priority: isPriority(raw.priority) ? raw.priority : "medium",
      labelIds: uniqueStrings(Array.isArray(raw.labelIds) ? raw.labelIds : []),
      dueDate: normalizeDateOnly(raw.dueDate),
      checklist: normalizeChecklist(Array.isArray(raw.checklist) ? raw.checklist : []),
      members: uniqueStrings(Array.isArray(raw.members) ? raw.members : []),
      attachments: normalizeAttachments((raw as { attachments?: unknown }).attachments),
      createdAt:
        typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      updatedAt:
        typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      completedAt: normalizeTimestamp((raw as { completedAt?: unknown }).completedAt),
    };
  }

  return normalized;
}

function normalizeChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .filter((item) => item && typeof item.text === "string")
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : makeId(`check-${index}`),
      text: item.text.trim(),
      done: Boolean(item.done),
    }))
    .filter((item) => item.text);
}

function normalizeAttachments(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: AttachmentRef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const item = raw as Partial<AttachmentRef>;
    if (
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id) ||
      (item.type !== "photo" && item.type !== "audio") ||
      typeof item.fileName !== "string" ||
      !item.fileName
    ) {
      continue;
    }
    seen.add(item.id);
    result.push({
      id: item.id,
      type: item.type,
      fileName: item.fileName,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
      size: Number.isFinite(Number(item.size)) ? Math.max(0, Math.round(Number(item.size))) : 0,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    });
  }
  return result;
}

function normalizeDeletedCards(
  value: unknown,
  cards: Record<string, Card>,
): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result: Record<string, string> = {};
  for (const [cardId, deletedAt] of Object.entries(value as Record<string, unknown>)) {
    if (typeof deletedAt !== "string" || !deletedAt || cards[cardId] || deletedAt < cutoff) {
      continue;
    }
    result[cardId] = deletedAt;
  }
  return result;
}

function normalizeDateOnly(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : "";
}

function normalizeWipLimit(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  const numberValue = Math.round(Number(value));
  if (!Number.isFinite(numberValue)) {
    return 3;
  }
  return clamp(numberValue, 1, 99);
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function isPriority(value: unknown): value is Priority {
  return value === "low" || value === "medium" || value === "high";
}

function isBoardLike(value: unknown): value is BoardState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const board = value as Partial<BoardState>;
  return Array.isArray(board.columns) && typeof board.cards === "object";
}

function cloneBoard(board: BoardState): BoardState {
  return {
    ...board,
    labels: board.labels.map((label) => ({ ...label })),
    deletedCards: { ...board.deletedCards },
    columns: board.columns.map((column) => ({
      ...column,
      cardIds: [...column.cardIds],
    })),
    cards: Object.fromEntries(
      Object.entries(board.cards).map(([id, card]) => [
        id,
        {
          ...card,
          labelIds: [...card.labelIds],
          members: [...card.members],
          checklist: card.checklist.map((item) => ({ ...item })),
          attachments: card.attachments.map((ref) => ({ ...ref })),
        },
      ]),
    ),
  };
}

function touch(board: BoardState, now = new Date()): BoardState {
  return { ...board, lastSavedAt: normalizeTimestamp(now) ?? new Date().toISOString() };
}

function normalizeTimestamp(value: unknown): string | null {
  const date = toValidDate(value);
  return date ? date.toISOString() : null;
}

function toValidDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function getLocalMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRecentMonthKeys(referenceDate: Date, count: number): string[] {
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - offset, 1);
    keys.push(getLocalMonthKey(date));
  }
  return keys;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
