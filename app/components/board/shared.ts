import type {
  AttachmentRef,
  BoardState,
  Card,
  ChecklistItem,
  Column,
  Filters,
  Priority,
} from "../../board-model";
import type { CSSProperties } from "react";

export type StyleWithVars = CSSProperties &
  Partial<Record<"--label" | "--progress", string>>;

export type CardDraft = {
  title: string;
  description: string;
  priority: Priority;
  labelIds: string[];
  dueDate: string;
  members: string;
  checklist: ChecklistItem[];
  attachments: AttachmentRef[];
};

export type DetailState =
  | { mode: "add"; columnId: string; draft: CardDraft }
  | { mode: "edit"; cardId: string; draft: CardDraft };

export type ConfirmState =
  | { type: "delete"; cardId: string; title: string }
  | { type: "reset" }
  | null;

export const emptyFilters: Filters = {
  query: "",
  labelId: "",
  priority: "all",
  due: "all",
};

export const priorityText: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function createDraft(): CardDraft {
  return {
    title: "",
    description: "",
    priority: "medium",
    labelIds: [],
    dueDate: "",
    members: "",
    checklist: [],
    attachments: [],
  };
}

export function draftFromCard(card: Card): CardDraft {
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    labelIds: [...card.labelIds],
    dueDate: card.dueDate,
    members: card.members.join(", "),
    checklist: card.checklist.map((item) => ({ ...item })),
    attachments: card.attachments.map((ref) => ({ ...ref })),
  };
}

export function draftToCardInput(draft: CardDraft) {
  return {
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    labelIds: draft.labelIds,
    dueDate: draft.dueDate,
    members: draft.members
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean),
    checklist: draft.checklist,
    attachments: draft.attachments,
  };
}

export function locateCard(board: BoardState, cardId: string) {
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const cardIndex = board.columns[columnIndex].cardIds.indexOf(cardId);
    if (cardIndex >= 0) {
      return { columnIndex, cardIndex };
    }
  }
  return null;
}

export function findNearestFocus(columns: Column[], cardId: string) {
  for (const column of columns) {
    const index = column.cardIds.indexOf(cardId);
    if (index >= 0) {
      return column.cardIds[index + 1] ?? column.cardIds[index - 1] ?? null;
    }
  }
  return null;
}
