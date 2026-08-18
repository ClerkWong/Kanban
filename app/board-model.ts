export const BOARD_SCHEMA_VERSION = 9;

export type ServiceClass = "standard" | "expedite" | "fixedDate" | "intangible";
export const SERVICE_CLASSES = ["standard", "expedite", "fixedDate", "intangible"] as const;
export const MAX_BLOCKED_MS = 100 * 365 * 24 * 3600 * 1000;

/** 某位指派人在這張卡上的計畫投入期間；date-only，含頭尾。 */
export type AssignmentWindow = {
  userId: string;
  startDate: string;
  endDate: string;
};

export const MAX_ASSIGNMENT_WINDOWS_PER_CARD = 20;

/** 卡片層級上限：頂層為第 1 層，其下最多再兩層。 */
export const MAX_CARD_DEPTH = 3;

export type BoardSettings = {
  agingWarnDays: number;
  agingAlertDays: number;
  expediteWipLimit: number | null;
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  agingWarnDays: 3,
  agingAlertDays: 7,
  expediteWipLimit: 1,
};

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
  /** Canonical Project user IDs assigned to this task. Multiple assignees are allowed. */
  assigneeUserIds: string[];
  blocked: boolean;
  blockedReason: string;
  blockedAt: string | null;
  /** Legacy free-text labels retained for v1–v4 compatibility; never used for authorization. */
  members: string[];
  attachments: AttachmentRef[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** 進入目前欄位的時間；跨欄移動時更新，同欄重排不更新。 */
  columnEnteredAt: string;
  /** 首次離開第一欄的時間；只設定一次，移回第一欄不清除。 */
  startedAt: string | null;
  /** 已解除的阻塞累計毫秒數，不含進行中的阻塞。 */
  blockedMs: number;
  serviceClass: ServiceClass;
  /** 每位指派人各自的計畫投入期間；缺項＝該指派尚未排期，不是錯誤。 */
  assignmentWindows: AssignmentWindow[];
  /** 上層任務的卡片 id；null 表示直接掛在時間軸上。
   *  純結構分解：不影響完成、WIP、老化、Cycle Time 或加急排序的任何計算。 */
  parentCardId: string | null;
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
  settings: BoardSettings;
};

export type Filters = {
  query: string;
  labelId: string;
  priority: "all" | Priority;
  due: DueFilter;
  assigneeUserId: string;
  blocked: "all" | "blocked" | "unblocked";
  serviceClass: "all" | ServiceClass;
};

export const UNASSIGNED_FILTER_VALUE = "__unassigned__";

export type BoardStats = {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  expedite: number;
};

export const STORAGE_KEY = "kanban-pwa-board-v1";
export const DONE_COLUMN_ID = "done";
export const COLUMN_TITLE_MAX_LENGTH = 40;
export const MAX_BOARD_COLUMNS = 20;
export const TOMBSTONE_TTL_DAYS = 30;

export type ColumnTitleValidationError = "missing" | "empty" | "too_long" | "duplicate";
export type NewColumnValidationError = ColumnTitleValidationError | "max_columns";
export type ColumnDeletionValidationError =
  | "missing"
  | "done"
  | "not_empty"
  | "minimum_columns";

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
    settings: { ...DEFAULT_BOARD_SETTINGS },
  };
}

/** Standard empty board used when a Project is created. */
export function createEmptyBoard(now = new Date()): BoardState {
  const template = createDemoBoard(now);
  return {
    ...template,
    cards: {},
    deletedCards: {},
    columns: template.columns.map((column) => ({ ...column, cardIds: [] })),
    lastSavedAt: now.toISOString(),
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
      filters.due !== "all" ||
      filters.assigneeUserId ||
      filters.blocked !== "all" ||
      filters.serviceClass !== "all",
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
    expedite: cards.filter(
      (card) => card.serviceClass === "expedite" && !doneIds.has(card.id),
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
        const assigneeMatches =
          !filters.assigneeUserId ||
          (filters.assigneeUserId === UNASSIGNED_FILTER_VALUE
            ? card.assigneeUserIds.length === 0
            : card.assigneeUserIds.includes(filters.assigneeUserId));
        const blockedMatches =
          filters.blocked === "all" ||
          (filters.blocked === "blocked" ? card.blocked : !card.blocked);
        const serviceClassMatches =
          filters.serviceClass === "all" || card.serviceClass === filters.serviceClass;

        return textMatches && labelMatches && priorityMatches && dueMatches &&
          assigneeMatches && blockedMatches && serviceClassMatches;
      });
  }

  return result;
}

export function addCard(
  board: BoardState,
  columnId: string,
  input: Partial<Card> & Pick<Card, "title">,
  now = new Date(),
): BoardState {
  const id = input.id ?? makeId("card");
  const timestamp = normalizeTimestamp(now) ?? new Date().toISOString();
  const blockedReason = normalizeBlockedReason(input.blockedReason);
  const blocked = Boolean(input.blocked && blockedReason);
  const firstColumnId = board.columns[0]?.id;
  const assigneeUserIds = uniqueStrings(input.assigneeUserIds ?? []);
  const card: Card = {
    id,
    title: input.title.trim(),
    description: input.description ?? "",
    priority: input.priority ?? "medium",
    labelIds: uniqueStrings(input.labelIds ?? []),
    dueDate: normalizeDateOnly(input.dueDate ?? ""),
    checklist: normalizeChecklist(input.checklist ?? []),
    assigneeUserIds,
    blocked,
    blockedReason: blocked ? blockedReason : "",
    blockedAt: blocked ? normalizeTimestamp(input.blockedAt) ?? timestamp : null,
    members: uniqueStrings(input.members ?? []),
    attachments: normalizeAttachments(input.attachments ?? []),
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
    completedAt:
      columnId === DONE_COLUMN_ID
        ? normalizeTimestamp(input.completedAt) ?? timestamp
        : null,
    columnEnteredAt: normalizeTimestamp(input.columnEnteredAt) ?? timestamp,
    startedAt:
      normalizeTimestamp(input.startedAt) ??
      (columnId !== firstColumnId ? timestamp : null),
    blockedMs: normalizeBlockedMs(input.blockedMs),
    serviceClass: isServiceClass(input.serviceClass) ? input.serviceClass : "standard",
    assignmentWindows: normalizeAssignmentWindows(input.assignmentWindows, assigneeUserIds),
    parentCardId: typeof input.parentCardId === "string" ? input.parentCardId : null,
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
  return normalizeBoard(touch(next, now));
}

export function updateCard(
  board: BoardState,
  cardId: string,
  patch: Partial<Omit<Card, "id" | "createdAt">>,
  now = new Date(),
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
  const timestamp = normalizeTimestamp(now) ?? new Date().toISOString();
  const blockedReason = normalizeBlockedReason(
    patch.blockedReason ?? existing.blockedReason,
  );
  const blocked = Boolean((patch.blocked ?? existing.blocked) && blockedReason);
  const wasBlocked = existing.blocked;
  let blockedMs = normalizeBlockedMs(patch.blockedMs ?? existing.blockedMs);
  if (wasBlocked && !blocked) {
    const since = toValidDate(existing.blockedAt);
    const until = toValidDate(timestamp);
    if (since && until && until.getTime() > since.getTime()) {
      blockedMs = Math.min(blockedMs + (until.getTime() - since.getTime()), MAX_BLOCKED_MS);
    }
  }
  const assigneeUserIds = uniqueStrings(patch.assigneeUserIds ?? existing.assigneeUserIds);
  next.cards[cardId] = {
    ...existing,
    ...patch,
    title,
    labelIds: uniqueStrings(patch.labelIds ?? existing.labelIds),
    dueDate: normalizeDateOnly(patch.dueDate ?? existing.dueDate),
    checklist: normalizeChecklist(patch.checklist ?? existing.checklist),
    assigneeUserIds,
    blocked,
    blockedReason: blocked ? blockedReason : "",
    blockedAt: blocked
      ? existing.blocked
        ? existing.blockedAt ?? timestamp
        : normalizeTimestamp(patch.blockedAt) ?? timestamp
      : null,
    members: uniqueStrings(patch.members ?? existing.members),
    attachments: normalizeAttachments(patch.attachments ?? existing.attachments),
    blockedMs,
    serviceClass: isServiceClass(patch.serviceClass ?? existing.serviceClass)
      ? (patch.serviceClass ?? existing.serviceClass)
      : "standard",
    assignmentWindows: normalizeAssignmentWindows(
      patch.assignmentWindows ?? existing.assignmentWindows,
      assigneeUserIds,
    ),
    parentCardId: patch.parentCardId !== undefined ? patch.parentCardId : existing.parentCardId,
    columnEnteredAt: existing.columnEnteredAt,
    startedAt: patch.startedAt !== undefined
      ? normalizeTimestamp(patch.startedAt)
      : existing.startedAt,
    updatedAt: timestamp,
  };

  return normalizeBoard(touch(next, now));
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

  const sourceColumn =
    sourceColumnId !== undefined ? board.columns[sourceColumnId] : undefined;
  const crossColumn = sourceColumn !== undefined && sourceColumn.id !== targetColumnId;

  if (crossColumn) {
    const timestamp = normalizeTimestamp(now) ?? new Date().toISOString();
    const card = next.cards[cardId];
    const firstColumnId = board.columns[0]?.id;
    const leavesFirstColumn =
      sourceColumn.id === firstColumnId && targetColumnId !== firstColumnId;
    next.cards[cardId] = {
      ...card,
      columnEnteredAt: timestamp,
      startedAt: card.startedAt ?? (leavesFirstColumn ? timestamp : null),
      completedAt: targetIsDone ? timestamp : sourceIsDone ? null : card.completedAt,
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

export function validateNewColumnTitle(
  board: BoardState,
  value: string,
): NewColumnValidationError | null {
  if (board.columns.length >= MAX_BOARD_COLUMNS) {
    return "max_columns";
  }
  return validateColumnTitleValue(board, null, value);
}

export function addColumn(
  board: BoardState,
  input: { title: string; wipLimit?: number | null },
  now = new Date(),
): BoardState {
  if (validateNewColumnTitle(board, input.title)) {
    return board;
  }
  const doneIndex = board.columns.findIndex((column) => column.id === DONE_COLUMN_ID);
  const insertionIndex = doneIndex >= 0 ? doneIndex : board.columns.length;
  const next = cloneBoard(board);
  next.columns.splice(insertionIndex, 0, {
    id: makeId("column"),
    title: input.title.trim(),
    wipLimit: input.wipLimit === null
      ? null
      : clamp(Math.round(Number(input.wipLimit) || 3), 1, 99),
    cardIds: [],
  });
  return normalizeBoard(touch(next, now));
}

export function moveColumnRelative(
  board: BoardState,
  columnId: string,
  direction: "left" | "right",
  now = new Date(),
): BoardState {
  const sourceIndex = board.columns.findIndex((column) => column.id === columnId);
  if (sourceIndex < 0) return board;
  const targetIndex = direction === "left" ? sourceIndex - 1 : sourceIndex + 1;
  if (targetIndex < 0 || targetIndex >= board.columns.length) return board;

  const next = cloneBoard(board);
  const [column] = next.columns.splice(sourceIndex, 1);
  next.columns.splice(targetIndex, 0, column);
  return normalizeBoard(touch(next, now));
}

export function validateColumnDeletion(
  board: BoardState,
  columnId: string,
): ColumnDeletionValidationError | null {
  const column = board.columns.find((candidate) => candidate.id === columnId);
  if (!column) return "missing";
  if (column.id === DONE_COLUMN_ID) return "done";
  if (column.cardIds.length) return "not_empty";
  if (board.columns.length <= 2) return "minimum_columns";
  return null;
}

export function deleteColumn(
  board: BoardState,
  columnId: string,
  now = new Date(),
): BoardState {
  if (validateColumnDeletion(board, columnId)) {
    return board;
  }
  const next = cloneBoard(board);
  next.columns = next.columns.filter((column) => column.id !== columnId);
  return normalizeBoard(touch(next, now));
}

export function validateColumnTitle(
  board: BoardState,
  columnId: string,
  value: string,
): ColumnTitleValidationError | null {
  if (!board.columns.some((column) => column.id === columnId)) {
    return "missing";
  }
  return validateColumnTitleValue(board, columnId, value);
}

function validateColumnTitleValue(
  board: BoardState,
  excludedColumnId: string | null,
  value: string,
): Exclude<ColumnTitleValidationError, "missing"> | null {
  const title = value.trim();
  if (!title) {
    return "empty";
  }
  if (title.length > COLUMN_TITLE_MAX_LENGTH) {
    return "too_long";
  }
  const titleKey = columnTitleKey(title);
  if (board.columns.some(
    (column) => column.id !== excludedColumnId && columnTitleKey(column.title) === titleKey,
  )) {
    return "duplicate";
  }
  return null;
}

export function updateColumnTitle(
  board: BoardState,
  columnId: string,
  value: string,
  now = new Date(),
): BoardState {
  if (validateColumnTitle(board, columnId, value)) {
    return board;
  }
  const title = value.trim();
  const current = board.columns.find((column) => column.id === columnId);
  if (!current || current.title === title) {
    return board;
  }
  const next = cloneBoard(board);
  next.columns = next.columns.map((column) =>
    column.id === columnId ? { ...column, title } : column,
  );
  return normalizeBoard(touch(next, now));
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
      (version !== 1 &&
        version !== 2 &&
        version !== 3 &&
        version !== 4 &&
        version !== 5 &&
        version !== 6 &&
        version !== 7 &&
        version !== 8 &&
        version !== BOARD_SCHEMA_VERSION)
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
  // 層級關聯需要完整卡片集合，因此在 normalizeCards 之後另跑一輪。
  normalizeCardHierarchy(cards);
  const columns = normalizeColumns(board.columns, cards);
  const sourceVersion = Number(board.version);
  const needsCompletionMigration = sourceVersion >= 1 && sourceVersion <= 3;

  if (needsCompletionMigration) {
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

  let orphanAdded = false;
  for (const cardId of Object.keys(cards)) {
    if (!assigned.has(cardId)) {
      firstColumn.cardIds.push(cardId);
      assigned.add(cardId);
      orphanAdded = true;
    }
  }
  if (orphanAdded) {
    firstColumn.cardIds = partitionExpediteFirst(firstColumn.cardIds, cards);
  }

  return {
    version: BOARD_SCHEMA_VERSION,
    labels,
    cards,
    deletedCards: normalizeDeletedCards(board.deletedCards, cards),
    columns,
    lastSavedAt: board.lastSavedAt || new Date().toISOString(),
    settings: normalizeBoardSettings((board as { settings?: unknown }).settings),
  };
}

export function assertBoardInvariants(board: BoardState): void {
  const columnIds = board.columns.map((column) => column.id);
  if (new Set(columnIds).size !== columnIds.length) {
    throw new Error("Column IDs must be unique.");
  }
  if (columnIds.filter((columnId) => columnId === DONE_COLUMN_ID).length !== 1) {
    throw new Error("Board must contain exactly one completion column.");
  }
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
  for (const column of board.columns) {
    let sawNonExpedite = false;
    for (const cardId of column.cardIds) {
      const isExpedite = board.cards[cardId]?.serviceClass === "expedite";
      if (isExpedite && sawNonExpedite) {
        throw new Error(
          `Column ${column.id} has an expedite card after a non-expedite card.`,
        );
      }
      if (!isExpedite) sawNonExpedite = true;
    }
  }
  for (const cardId of cardIds) {
    const parentCardId = board.cards[cardId].parentCardId;
    // `board.cards[x]` 是原型鏈屬性查找：x 為 "constructor"／"__proto__" 等
    // Object.prototype 上既有的名稱時一律 truthy，會把「不存在的父卡」誤判成
    // 「存在」。必須用 Object.hasOwn 只認自身屬性，不能用真假值判斷存在性。
    if (parentCardId !== null && !Object.hasOwn(board.cards, parentCardId)) {
      throw new Error(`Card ${cardId} points at a missing parent ${parentCardId}.`);
    }
    if (parentCardId === cardId) {
      throw new Error(`Card ${cardId} cannot be its own parent.`);
    }
  }
  // 環與深度一起走：往上走時重複造訪即為環。這裡不能改用 cardDepth——它遇到環會在
  // 回到起點時就停下並回傳一個小的值，偵測不到環。
  for (const cardId of cardIds) {
    const seen = new Set<string>([cardId]);
    let depth = 1;
    let current = board.cards[cardId].parentCardId;
    while (current !== null) {
      if (seen.has(current)) {
        throw new Error(`Card hierarchy contains a cycle at ${current}.`);
      }
      // 防禦性重複檢查（上面的迴圈理論上已保證每個非 null parentCardId 都是
      // board.cards 的自身鍵）：一旦這裡失守，下一行會對繼承屬性（如
      // "constructor" 解析出的建構函式）取 .parentCardId 得到 undefined、
      // 而非 null，讓迴圈多走一步查詢字面鍵 "undefined" 而真正變成 undefined，
      // 對 undefined 取屬性就會拋出未分類的 TypeError，而不是這裡這種明確錯誤。
      if (!Object.hasOwn(board.cards, current)) {
        throw new Error(`Card ${cardId} points at a missing parent ${current}.`);
      }
      seen.add(current);
      depth += 1;
      if (depth > MAX_CARD_DEPTH) {
        throw new Error(`Card ${cardId} exceeds the maximum depth ${MAX_CARD_DEPTH}.`);
      }
      current = board.cards[current].parentCardId;
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

export type AgingLevel = "normal" | "warn" | "alert";

export function getCardAgingDays(card: Card, today = getLocalDateString()): number {
  const entered = toValidDate(card.columnEnteredAt);
  if (!entered) return 0;
  return Math.max(0, diffLocalDays(getLocalDateString(entered), today));
}

export function getAgingLevel(days: number, settings: BoardSettings): AgingLevel {
  if (days >= settings.agingAlertDays) return "alert";
  if (days >= settings.agingWarnDays) return "warn";
  return "normal";
}

export function getCardBlockedTotalMs(card: Card, now = new Date()): number {
  let total = card.blockedMs;
  if (card.blocked) {
    const since = toValidDate(card.blockedAt);
    if (since) {
      const completed = toValidDate(card.completedAt);
      const until = completed && completed.getTime() < now.getTime() ? completed : now;
      total += Math.max(0, until.getTime() - since.getTime());
    }
  }
  return Math.min(total, MAX_BLOCKED_MS);
}

export type MonthlyFlowStats = MonthlyCompletion & {
  cycleTimeMedianDays: number | null;
  cycleTimeAverageDays: number | null;
  unmeasuredCount: number;
  blockedTotalMs: number;
  flowEfficiencyMedian: number | null;
  serviceClassCounts: Record<ServiceClass, number>;
};

export function getMonthlyFlowStats(
  board: BoardState,
  recentMonths = 6,
  now = new Date(),
): MonthlyFlowStats[] {
  return getMonthlyCompletionStats(board, recentMonths, now).map((month) => {
    const cycleTimes: number[] = [];
    const efficiencies: number[] = [];
    let unmeasuredCount = 0;
    let blockedTotalMs = 0;
    const serviceClassCounts: Record<ServiceClass, number> = {
      standard: 0, expedite: 0, fixedDate: 0, intangible: 0,
    };
    for (const card of month.cards) {
      serviceClassCounts[card.serviceClass] += 1;
      const blocked = getCardBlockedTotalMs(card, now);
      blockedTotalMs += blocked;
      const started = toValidDate(card.startedAt);
      const completed = toValidDate(card.completedAt);
      if (!started || !completed || completed.getTime() <= started.getTime()) {
        unmeasuredCount += 1;
        continue;
      }
      const cycleMs = completed.getTime() - started.getTime();
      cycleTimes.push(cycleMs / DAY_MS);
      efficiencies.push(clamp((cycleMs - blocked) / cycleMs, 0, 1));
    }
    return {
      ...month,
      cycleTimeMedianDays: roundOrNull(median(cycleTimes)),
      cycleTimeAverageDays: roundOrNull(average(cycleTimes)),
      unmeasuredCount,
      blockedTotalMs,
      flowEfficiencyMedian: median(efficiencies),
      serviceClassCounts,
    };
  });
}

export function updateBoardSettings(
  board: BoardState,
  patch: Partial<BoardSettings>,
  now = new Date(),
): BoardState {
  const next = cloneBoard(board);
  next.settings = normalizeBoardSettings({ ...board.settings, ...patch });
  return normalizeBoard(touch(next, now));
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
    assigneeUserIds: [],
    blocked: false,
    blockedReason: "",
    blockedAt: null,
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
    columnEnteredAt: "2026-07-01T09:00:00.000Z",
    startedAt: input.id === "card-done" ? "2026-06-28T09:00:00.000Z" : null,
    blockedMs: 0,
    serviceClass: "standard",
    assignmentWindows: [],
    parentCardId: null,
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

// 穩定分割：加急卡恆在非加急卡之前，兩區段內保持原相對順序。
// normalizeColumns 與 normalizeBoard 的孤兒卡補回都需要此不變量，故抽成共用函式。
function partitionExpediteFirst(cardIds: string[], cards: Record<string, Card>): string[] {
  return [
    ...cardIds.filter((cardId) => cards[cardId]?.serviceClass === "expedite"),
    ...cardIds.filter((cardId) => cards[cardId]?.serviceClass !== "expedite"),
  ];
}

function normalizeColumns(columns: Column[], cards: Record<string, Card>): Column[] {
  const seen = new Set<string>();
  const source = Array.isArray(columns) && columns.length ? columns : createDemoBoard().columns;

  return source.map((column, index) => {
    const id = typeof column.id === "string" && column.id ? column.id : `column-${index}`;
    const cardIds = Array.isArray(column.cardIds)
      ? column.cardIds.filter((cardId) => {
          // `cards[x]` 是原型鏈屬性查找：x 為 "constructor"／"__proto__" 等
          // Object.prototype 上既有的名稱時一律 truthy，會把不存在的卡片 id
          // 誤判成「存在」而留在 cardIds 裡，讓下游（filterCards 等）拿去查找
          // 時也落到同一個繼承屬性，混進一張形狀不對的「假卡片」而讓 UI 崩潰。
          if (typeof cardId !== "string" || !Object.hasOwn(cards, cardId) || seen.has(cardId)) {
            return false;
          }
          seen.add(cardId);
          return true;
        })
      : [];

    return {
      id,
      title: normalizeColumnTitle(column.title) ?? "未命名",
      wipLimit: id === DONE_COLUMN_ID ? null : normalizeWipLimit(column.wipLimit),
      cardIds: partitionExpediteFirst(cardIds, cards),
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

    const blockedReason = normalizeBlockedReason(
      (raw as { blockedReason?: unknown }).blockedReason,
    );
    const blocked = Boolean((raw as { blocked?: unknown }).blocked && blockedReason);
    const assigneeUserIds = uniqueStrings(
      Array.isArray((raw as { assigneeUserIds?: unknown }).assigneeUserIds)
        ? (raw as { assigneeUserIds: string[] }).assigneeUserIds
        : [],
    );
    normalized[cardId] = {
      id: cardId,
      title: raw.title.trim() || "未命名卡片",
      description: typeof raw.description === "string" ? raw.description : "",
      priority: isPriority(raw.priority) ? raw.priority : "medium",
      labelIds: uniqueStrings(Array.isArray(raw.labelIds) ? raw.labelIds : []),
      dueDate: normalizeDateOnly(raw.dueDate),
      checklist: normalizeChecklist(Array.isArray(raw.checklist) ? raw.checklist : []),
      assigneeUserIds,
      blocked,
      blockedReason: blocked ? blockedReason : "",
      blockedAt: blocked
        ? normalizeTimestamp((raw as { blockedAt?: unknown }).blockedAt) ??
          normalizeTimestamp(raw.updatedAt)
        : null,
      members: uniqueStrings(Array.isArray(raw.members) ? raw.members : []),
      attachments: normalizeAttachments((raw as { attachments?: unknown }).attachments),
      createdAt:
        typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      updatedAt:
        typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      completedAt: normalizeTimestamp((raw as { completedAt?: unknown }).completedAt),
      columnEnteredAt:
        normalizeTimestamp((raw as { columnEnteredAt?: unknown }).columnEnteredAt) ??
        normalizeTimestamp(raw.updatedAt) ??
        normalizeTimestamp(raw.createdAt) ??
        new Date().toISOString(),
      startedAt: normalizeTimestamp((raw as { startedAt?: unknown }).startedAt),
      blockedMs: normalizeBlockedMs((raw as { blockedMs?: unknown }).blockedMs),
      serviceClass: isServiceClass((raw as { serviceClass?: unknown }).serviceClass)
        ? (raw as { serviceClass: ServiceClass }).serviceClass
        : "standard",
      assignmentWindows: normalizeAssignmentWindows(
        (raw as { assignmentWindows?: unknown }).assignmentWindows,
        assigneeUserIds,
      ),
      parentCardId: typeof (raw as { parentCardId?: unknown }).parentCardId === "string"
        ? (raw as { parentCardId: string }).parentCardId
        : null,
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
    // 同一種原型鏈寫法：cardId 為 "constructor" 等名稱時 `cards[cardId]`
    // 一律 truthy，會誤判「這張卡片仍存在」而把它的刪除墓碑丟掉。
    if (
      typeof deletedAt !== "string" || !deletedAt ||
      Object.hasOwn(cards, cardId) || deletedAt < cutoff
    ) {
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

/** 只保留 userId 在指派名單內、兩個日期都合法且不反向的 window；同一 userId 取第一筆，
 *  並依 userId 排序成 canonical 形式，使 normalizeBoard 幂等、Worker 簽章穩定。 */
export function normalizeAssignmentWindows(
  value: unknown,
  assigneeUserIds: string[],
): AssignmentWindow[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(assigneeUserIds);
  const seen = new Set<string>();
  const windows: AssignmentWindow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { userId?: unknown; startDate?: unknown; endDate?: unknown };
    if (typeof entry.userId !== "string" || !allowed.has(entry.userId)) continue;
    if (seen.has(entry.userId)) continue;
    const startDate = normalizeDateOnly(entry.startDate);
    const endDate = normalizeDateOnly(entry.endDate);
    if (!startDate || !endDate || endDate < startDate) continue;
    seen.add(entry.userId);
    windows.push({ userId: entry.userId, startDate, endDate });
    if (windows.length >= MAX_ASSIGNMENT_WINDOWS_PER_CARD) break;
  }
  return windows.sort((left, right) => left.userId.localeCompare(right.userId));
}

/** 卡片所在層級；頂層為 1。走訪上限 MAX_CARD_DEPTH + 1 層，含環輸入亦保證終止。
 *  存在性判斷用 Object.hasOwn，不能用 `cards[x]` 的真假值——x 為
 *  "constructor"／"__proto__" 等 Object.prototype 上既有的名稱時一律 truthy，
 *  會把不存在的父卡誤判成存在的一層，算出比實際多一層的深度。這個函式可能被
 *  直接餵未經 normalizeCardHierarchy 正規化的 cards（例如 eligibleParentCards），
 *  不能假設呼叫端已經清過壞連結。 */
export function cardDepth(cards: Record<string, Card>, cardId: string): number {
  let depth = 1;
  let current = cards[cardId]?.parentCardId ?? null;
  const seen = new Set<string>([cardId]);
  while (current !== null && !seen.has(current) && Object.hasOwn(cards, current)) {
    depth += 1;
    seen.add(current);
    if (depth > MAX_CARD_DEPTH + 1) break;
    current = cards[current].parentCardId;
  }
  return depth;
}

/** 該卡的全部子孫，不含自己。 */
export function descendantCardIds(
  cards: Record<string, Card>,
  cardId: string,
): Set<string> {
  const result = new Set<string>();
  const queue = [cardId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const [id, card] of Object.entries(cards)) {
      if (card.parentCardId === current && !result.has(id) && id !== cardId) {
        result.add(id);
        queue.push(id);
      }
    }
  }
  return result;
}

/** 以該卡為根的子樹高度；葉節點為 1。存在性判斷用 Object.hasOwn，理由同
 *  cardDepth——descendants 由 descendantCardIds 以「值相等」找出，往上走時
 *  理論上不會遇到繼承屬性，但直接用 `cards[x]` 真假值判斷仍是同一種脆弱寫法，
 *  一併改掉以防未來呼叫方式改變而重新暴露。 */
export function subtreeHeight(cards: Record<string, Card>, cardId: string): number {
  const descendants = descendantCardIds(cards, cardId);
  let height = 1;
  for (const id of descendants) {
    let depth = 1;
    let current: string | null = cards[id]?.parentCardId ?? null;
    while (current !== null && current !== cardId && Object.hasOwn(cards, current)) {
      depth += 1;
      current = cards[current].parentCardId;
      if (depth > MAX_CARD_DEPTH) break;
    }
    height = Math.max(height, depth + 1);
  }
  return height;
}

/** 可以當這張卡上層任務的卡片 id：排除自己、自己的子孫，以及會讓自身子樹超過
 *  MAX_CARD_DEPTH 的目標。UI 用它產生選單，使用者就選不到必然被 Worker 400 擋下的值。 */
export function eligibleParentCards(
  cards: Record<string, Card>,
  cardId: string,
): string[] {
  const descendants = descendantCardIds(cards, cardId);
  const height = subtreeHeight(cards, cardId);
  return Object.keys(cards).filter((candidateId) => {
    // 在目前 MAX_CARD_DEPTH = 3 下，任何子孫的 cardDepth + height 恆 >= 4 > 3
    // （cardId 深度至少 1、子孫相對深度至少 1，兩者疊加後 height 至少 2），下面
    // 那行深度檢查已經隱含排除子孫，descendants.has 這行看起來像死碼。但這個
    // 等價只在 MAX_CARD_DEPTH <= 3 成立——上限一旦調到 4 以上，深度檢查不再自動
    // 擋掉子孫，這行就是唯一防止選單推薦「把卡片掛到自己子孫底下」（等於直接
    // 造環）的防線，別因為看似死碼而簡化掉。
    if (candidateId === cardId || descendants.has(candidateId)) return false;
    return cardDepth(cards, candidateId) + height <= MAX_CARD_DEPTH;
  });
}

/** 原地修正三種壞連結。卡片 id 以字典序走訪以確保決定性；
 *  清連結只會讓深度變小，因此第二次執行不會再有變動。 */
export function normalizeCardHierarchy(cards: Record<string, Card>): void {
  const ids = Object.keys(cards).sort();

  // 1. 指向不存在的卡片，或指向自己
  // `cards[x]` 是原型鏈屬性查找：x 為 "constructor"／"__proto__" 等
  // Object.prototype 上既有的名稱時一律 truthy，會把「不存在的父卡」誤判成
  // 「存在」而放過壞連結。必須用 Object.hasOwn 只認自身屬性。
  for (const id of ids) {
    const parentCardId = cards[id].parentCardId;
    if (parentCardId !== null && (parentCardId === id || !Object.hasOwn(cards, parentCardId))) {
      cards[id] = { ...cards[id], parentCardId: null };
    }
  }

  // 2. 斷環：從每張卡往上走，遇到已在本次路徑上的卡就斷掉造成閉合的那一條。
  // 上面第 1 步理論上已保證每個非 null parentCardId 都是 cards 的自身鍵，這裡的
  // Object.hasOwn 是防禦性重複檢查：一旦失守，`cards[current]` 落到繼承屬性
  // （如 "constructor" 解析出的建構函式）取 .parentCardId 會得到 undefined
  // 而非 null，迴圈會多走一步查詢字面鍵 "undefined"、對真正的 undefined 取屬性
  // 而拋出未分類的 TypeError（審查實測到的當機路徑），而不是乾淨地結束。
  for (const id of ids) {
    const path = new Set<string>([id]);
    let current = id;
    while (Object.hasOwn(cards, current) && cards[current].parentCardId !== null) {
      const parentCardId = cards[current].parentCardId as string;
      if (path.has(parentCardId)) {
        cards[current] = { ...cards[current], parentCardId: null };
        break;
      }
      path.add(parentCardId);
      current = parentCardId;
    }
  }

  // 3. 深度超過上限的降為頂層，而非整條鏈重排
  for (const id of ids) {
    if (cardDepth(cards, id) > MAX_CARD_DEPTH) {
      cards[id] = { ...cards[id], parentCardId: null };
    }
  }
}

function normalizeBlockedReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function normalizeColumnTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().slice(0, COLUMN_TITLE_MAX_LENGTH);
  return title || null;
}

export function columnTitleKey(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
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

export function isServiceClass(value: unknown): value is ServiceClass {
  return (SERVICE_CLASSES as readonly string[]).includes(value as string);
}

function normalizeBlockedMs(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return 0;
  return Math.min(Math.round(numberValue), MAX_BLOCKED_MS);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Math.round(Number(value));
  return Number.isFinite(numberValue) ? clamp(numberValue, min, max) : fallback;
}

export function normalizeBoardSettings(value: unknown): BoardSettings {
  const raw = value && typeof value === "object"
    ? (value as Partial<Record<keyof BoardSettings, unknown>>)
    : {};
  const agingWarnDays = clampInt(raw.agingWarnDays, 1, 365, DEFAULT_BOARD_SETTINGS.agingWarnDays);
  let agingAlertDays = clampInt(raw.agingAlertDays, 1, 365, DEFAULT_BOARD_SETTINGS.agingAlertDays);
  if (agingWarnDays >= agingAlertDays) {
    agingAlertDays = Math.min(agingWarnDays + 1, 365);
  }
  const expediteWipLimit = raw.expediteWipLimit === null
    ? null
    : clampInt(raw.expediteWipLimit, 1, 99, DEFAULT_BOARD_SETTINGS.expediteWipLimit ?? 1);
  return { agingWarnDays, agingAlertDays, expediteWipLimit };
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
    settings: { ...board.settings },
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
          assigneeUserIds: [...card.assigneeUserIds],
          members: [...card.members],
          checklist: card.checklist.map((item) => ({ ...item })),
          attachments: card.attachments.map((ref) => ({ ...ref })),
          assignmentWindows: card.assignmentWindows.map((window) => ({ ...window })),
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

const DAY_MS = 24 * 3600 * 1000;

function diffLocalDays(fromDateOnly: string, toDateOnly: string): number {
  const [fromYear, fromMonth, fromDay] = fromDateOnly.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDateOnly.split("-").map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
