const MAX_CHANGE_DETAILS = 200;
const MAX_LOG_STRING = 160;

export const BOARD_CHANGE_KINDS = [
  "card.created",
  "card.updated",
  "card.moved",
  "card.completed",
  "card.reopened",
  "card.deleted",
  "attachment.added",
  "attachment.removed",
] as const;

export type BoardChangeKind = typeof BOARD_CHANGE_KINDS[number];
export type CardField =
  | "title"
  | "description"
  | "priority"
  | "labelIds"
  | "dueDate"
  | "checklist"
  | "members"
  | "completedAt";

type AttachmentSnapshot = {
  id: string;
  type: string;
};

export type CardSnapshot = {
  id: string;
  title: string;
  description: string;
  priority: unknown;
  labelIds: unknown[];
  dueDate: string;
  checklist: unknown[];
  members: unknown[];
  attachments: AttachmentSnapshot[];
  completedAt: string | null;
};

export type BoardSnapshot = {
  columns: Array<{ id: string; cardIds: string[] }>;
  cards: Record<string, CardSnapshot>;
};

export type BoardChange =
  | { kind: "card.created"; cardId: string; title: string; columnId: string | null }
  | { kind: "card.updated"; cardId: string; title: string; fields: CardField[] }
  | {
    kind: "card.moved";
    cardId: string;
    title: string;
    fromColumnId: string | null;
    toColumnId: string | null;
    fromIndex: number | null;
    toIndex: number | null;
  }
  | { kind: "card.completed"; cardId: string; title: string; completedAt: string }
  | { kind: "card.reopened"; cardId: string; title: string }
  | { kind: "card.deleted"; cardId: string; title: string }
  | {
    kind: "attachment.added" | "attachment.removed";
    cardId: string;
    attachmentId: string;
    attachmentType: string;
  };

export type BoardDiff = {
  changes: BoardChange[];
  counts: Record<BoardChangeKind, number>;
  truncated: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, MAX_LOG_STRING) : fallback;
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseAttachments(value: unknown): AttachmentSnapshot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attachments: AttachmentSnapshot[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    attachments.push({
      id,
      type: typeof record?.type === "string" ? record.type : "unknown",
    });
  }
  return attachments;
}

export function parseBoardSnapshot(value: unknown): BoardSnapshot | null {
  const board = asRecord(value);
  const cardsValue = asRecord(board?.cards);
  if (!board || !Array.isArray(board.columns) || !cardsValue) return null;

  const cards: Record<string, CardSnapshot> = {};
  for (const [cardId, raw] of Object.entries(cardsValue)) {
    const card = asRecord(raw);
    if (!card) continue;
    cards[cardId] = {
      id: cardId,
      title: typeof card.title === "string" ? card.title : "未命名卡片",
      description: typeof card.description === "string" ? card.description : "",
      priority: card.priority,
      labelIds: safeArray(card.labelIds),
      dueDate: typeof card.dueDate === "string" ? card.dueDate : "",
      checklist: safeArray(card.checklist),
      members: safeArray(card.members),
      attachments: parseAttachments(card.attachments),
      completedAt: typeof card.completedAt === "string" ? card.completedAt : null,
    };
  }

  const columns = board.columns.flatMap((raw) => {
    const column = asRecord(raw);
    if (!column || typeof column.id !== "string") return [];
    return [{
      id: column.id,
      cardIds: Array.isArray(column.cardIds)
        ? column.cardIds.filter((id): id is string => typeof id === "string")
        : [],
    }];
  });
  return { columns, cards };
}

function cardPositions(board: BoardSnapshot) {
  const positions = new Map<string, { columnId: string; index: number }>();
  for (const column of board.columns) {
    column.cardIds.forEach((cardId, index) => {
      if (!positions.has(cardId)) positions.set(cardId, { columnId: column.id, index });
    });
  }
  return positions;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(before: CardSnapshot, after: CardSnapshot): CardField[] {
  const fields: CardField[] = [];
  if (before.title !== after.title) fields.push("title");
  if (before.description !== after.description) fields.push("description");
  if (!sameValue(before.priority, after.priority)) fields.push("priority");
  if (!sameValue(before.labelIds, after.labelIds)) fields.push("labelIds");
  if (before.dueDate !== after.dueDate) fields.push("dueDate");
  if (!sameValue(before.checklist, after.checklist)) fields.push("checklist");
  if (!sameValue(before.members, after.members)) fields.push("members");
  if (
    before.completedAt !== after.completedAt &&
    before.completedAt !== null &&
    after.completedAt !== null
  ) {
    fields.push("completedAt");
  }
  return fields;
}

function attachmentChanges(
  before: CardSnapshot | null,
  after: CardSnapshot | null,
): BoardChange[] {
  const beforeById = new Map((before?.attachments ?? []).map((item) => [item.id, item]));
  const afterById = new Map((after?.attachments ?? []).map((item) => [item.id, item]));
  const cardId = after?.id ?? before?.id;
  if (!cardId) return [];
  const changes: BoardChange[] = [];
  for (const id of [...afterById.keys()].sort()) {
    if (beforeById.has(id)) continue;
    const item = afterById.get(id);
    if (item) {
      changes.push({
        kind: "attachment.added",
        cardId: safeString(cardId),
        attachmentId: safeString(item.id),
        attachmentType: safeString(item.type, "unknown"),
      });
    }
  }
  for (const id of [...beforeById.keys()].sort()) {
    if (afterById.has(id)) continue;
    const item = beforeById.get(id);
    if (item) {
      changes.push({
        kind: "attachment.removed",
        cardId: safeString(cardId),
        attachmentId: safeString(item.id),
        attachmentType: safeString(item.type, "unknown"),
      });
    }
  }
  return changes;
}

function emptyCounts(): Record<BoardChangeKind, number> {
  return Object.fromEntries(
    BOARD_CHANGE_KINDS.map((kind) => [kind, 0]),
  ) as Record<BoardChangeKind, number>;
}

export function diffBoardStates(beforeValue: unknown, afterValue: unknown): BoardDiff {
  const before = parseBoardSnapshot(beforeValue) ?? { columns: [], cards: {} };
  const after = parseBoardSnapshot(afterValue) ?? { columns: [], cards: {} };
  const beforePositions = cardPositions(before);
  const afterPositions = cardPositions(after);
  const details: BoardChange[] = [];
  const counts = emptyCounts();

  const record = (change: BoardChange) => {
    counts[change.kind] += 1;
    if (details.length < MAX_CHANGE_DETAILS) details.push(change);
  };

  for (const cardId of Object.keys(after.cards).sort()) {
    const next = after.cards[cardId];
    const previous = before.cards[cardId];
    const nextPosition = afterPositions.get(cardId);
    if (!previous) {
      record({
        kind: "card.created",
        cardId: safeString(cardId),
        title: safeString(next.title),
        columnId: nextPosition ? safeString(nextPosition.columnId) : null,
      });
      for (const change of attachmentChanges(null, next)) record(change);
      continue;
    }

    const fields = changedFields(previous, next);
    if (fields.length) {
      record({
        kind: "card.updated",
        cardId: safeString(cardId),
        title: safeString(next.title),
        fields,
      });
    }
    const previousPosition = beforePositions.get(cardId);
    if (
      previousPosition?.columnId !== nextPosition?.columnId ||
      previousPosition?.index !== nextPosition?.index
    ) {
      record({
        kind: "card.moved",
        cardId: safeString(cardId),
        title: safeString(next.title),
        fromColumnId: previousPosition ? safeString(previousPosition.columnId) : null,
        toColumnId: nextPosition ? safeString(nextPosition.columnId) : null,
        fromIndex: previousPosition?.index ?? null,
        toIndex: nextPosition?.index ?? null,
      });
    }
    if (previous.completedAt === null && next.completedAt !== null) {
      record({
        kind: "card.completed",
        cardId: safeString(cardId),
        title: safeString(next.title),
        completedAt: safeString(next.completedAt),
      });
    } else if (previous.completedAt !== null && next.completedAt === null) {
      record({
        kind: "card.reopened",
        cardId: safeString(cardId),
        title: safeString(next.title),
      });
    }
    for (const change of attachmentChanges(previous, next)) record(change);
  }

  for (const cardId of Object.keys(before.cards).sort()) {
    if (after.cards[cardId]) continue;
    const previous = before.cards[cardId];
    record({
      kind: "card.deleted",
      cardId: safeString(cardId),
      title: safeString(previous.title),
    });
    for (const change of attachmentChanges(previous, null)) record(change);
  }

  return {
    changes: details,
    counts,
    truncated: Object.values(counts).reduce((sum, count) => sum + count, 0) > details.length,
  };
}
