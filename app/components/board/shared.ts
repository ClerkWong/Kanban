import type {
  AttachmentRef,
  BoardState,
  Card,
  ChecklistItem,
  Column,
  Filters,
  Priority,
  ServiceClass,
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
  assigneeUserIds: string[];
  blocked: boolean;
  blockedReason: string;
  members: string;
  checklist: ChecklistItem[];
  attachments: AttachmentRef[];
  serviceClass: ServiceClass;
};

export type DetailState =
  | { mode: "add"; columnId: string; draft: CardDraft }
  | { mode: "edit"; cardId: string; draft: CardDraft };

export type ConfirmState =
  | { type: "delete"; cardId: string; title: string }
  | { type: "deleteColumn"; columnId: string; title: string }
  | { type: "reset" }
  | null;

export type BoardOverlayKey = "detail" | "confirm" | "sync" | "report" | null;

export function getBoardOverlayKey({
  detail,
  confirmAction,
  syncOpen,
  reportOpen,
}: {
  detail: DetailState | null;
  confirmAction: ConfirmState;
  syncOpen: boolean;
  reportOpen: boolean;
}): BoardOverlayKey {
  if (confirmAction) return "confirm";
  if (reportOpen) return "report";
  if (syncOpen) return "sync";
  if (detail) return "detail";
  return null;
}

export function isImeComposing(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}

export const emptyFilters: Filters = {
  query: "",
  labelId: "",
  priority: "all",
  due: "all",
  assigneeUserId: "",
  blocked: "all",
  serviceClass: "all",
};

export const priorityText: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export const serviceClassText: Record<ServiceClass, string> = {
  standard: "標準",
  expedite: "加急",
  fixedDate: "固定日期",
  intangible: "無形",
};

export function createDraft(): CardDraft {
  return {
    title: "",
    description: "",
    priority: "medium",
    labelIds: [],
    dueDate: "",
    assigneeUserIds: [],
    blocked: false,
    blockedReason: "",
    members: "",
    checklist: [],
    attachments: [],
    serviceClass: "standard",
  };
}

export function draftFromCard(card: Card): CardDraft {
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    labelIds: [...card.labelIds],
    dueDate: card.dueDate,
    assigneeUserIds: [...card.assigneeUserIds],
    blocked: card.blocked,
    blockedReason: card.blockedReason,
    members: card.members.join(", "),
    checklist: card.checklist.map((item) => ({ ...item })),
    attachments: card.attachments.map((ref) => ({ ...ref })),
    serviceClass: card.serviceClass,
  };
}

export function draftToCardInput(draft: CardDraft) {
  return {
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    labelIds: draft.labelIds,
    dueDate: draft.dueDate,
    assigneeUserIds: [...new Set(draft.assigneeUserIds)],
    blocked: draft.blocked,
    blockedReason: draft.blocked ? draft.blockedReason.trim() : "",
    members: draft.members
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean),
    checklist: draft.checklist,
    attachments: draft.attachments,
    serviceClass: draft.serviceClass,
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
