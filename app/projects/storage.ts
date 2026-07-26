// Per-board local storage for multi-project / multi-board (v1): an
// injectable key-value interface plus safe read/write helpers for the
// project/board index, the active Board context, and per-board `BoardState`
// content. No network, no D1 -- see docs/superpowers/sdd/task-2-brief.md.
//
// House style follows app/board-model.ts and app/projects/model.ts: parsers
// accept `unknown` and narrow defensively; malformed input is dropped/
// rejected rather than coerced into a half-valid object.

import { parsePersistedBoard, serializeBoard, type BoardState } from "../board-model";
import { isLocalPlaceholderId, isUuid, normalizeResourceName } from "./model";
import type { BoardContext } from "./types";

// ---------------------------------------------------------------------------
// Injectable storage
// ---------------------------------------------------------------------------

/** The subset of the `Storage` (localStorage) API this module depends on.
 * Tests pass an in-memory fake instead of touching a browser global. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// ---------------------------------------------------------------------------
// Storage keys (verbatim from the multi-project implementation plan, Task 2)
// ---------------------------------------------------------------------------

export const WORKSPACE_INDEX_KEY = "kanban-workspace-index-v1";
export const ACTIVE_CONTEXT_KEY = "kanban-active-context-v1";

/** `kanban-attachment-queue-v2` and `kanban-sync-config-v2` are not per-board
 * and have no read/write logic yet -- their full R/W lives in Task 10. The
 * keys are exported here so that string is only ever written once. */
export const ATTACHMENT_QUEUE_KEY_V2 = "kanban-attachment-queue-v2";
export const SYNC_CONFIG_KEY_V2 = "kanban-sync-config-v2";

export function boardContentKey(boardId: string): string {
  return `kanban-board-v1:${boardId}`;
}

export function syncRevisionKey(boardId: string): string {
  return `kanban-sync-revision-v2:${boardId}`;
}

// ---------------------------------------------------------------------------
// Local-only workspace placeholder
// ---------------------------------------------------------------------------

/** Task 1 (`app/projects/model.ts`) only defines Project/Board placeholder
 * IDs because v1 supports a single Workspace (design spec §10) that a client
 * only learns about after talking to a server. Before that first contact --
 * i.e. for a purely local, never-synced install -- `BoardContext.workspaceId`
 * still needs *some* value, so this module defines the matching local-only
 * placeholder here rather than in the shared domain layer. Like the Task 1
 * placeholders, this must never be sent to an API as a real workspace id. */
export const LOCAL_LEGACY_WORKSPACE_ID = "local:legacy-workspace";

function isValidWorkspaceId(value: unknown): value is string {
  return isUuid(value) || value === LOCAL_LEGACY_WORKSPACE_ID;
}

function isValidProjectOrBoardId(value: unknown): value is string {
  return isUuid(value) || isLocalPlaceholderId(value);
}

function assertValidProjectOrBoardId(value: unknown, field: string): asserts value is string {
  if (!isValidProjectOrBoardId(value)) {
    throw new Error(`${field} 必須是 UUID 或已知的本機 placeholder ID。`);
  }
}

// ---------------------------------------------------------------------------
// Workspace index (Project + Board metadata local index)
// ---------------------------------------------------------------------------

/** Minimal local-only Project index record. Full `Project` fields (Task 1)
 * such as `createdBy`/timestamps only exist once the resource has been
 * created on the server; the local index only needs enough to resolve a
 * `BoardContext` and render a project/board picker before that happens. */
export type LocalProjectIndexEntry = {
  id: string;
  name: string;
};

/** Minimal local-only Board index record -- see `LocalProjectIndexEntry`. */
export type LocalBoardIndexEntry = {
  id: string;
  projectId: string;
  name: string;
};

export type WorkspaceIndex = {
  projects: LocalProjectIndexEntry[];
  boards: LocalBoardIndexEntry[];
};

export const EMPTY_WORKSPACE_INDEX: WorkspaceIndex = { projects: [], boards: [] };

function parseProjectIndexEntry(value: unknown): LocalProjectIndexEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const normalizedName = normalizeResourceName(raw.name);
  if (!isValidProjectOrBoardId(raw.id) || !normalizedName) {
    return null;
  }
  return { id: raw.id, name: normalizedName.name };
}

function parseBoardIndexEntry(value: unknown): LocalBoardIndexEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const normalizedName = normalizeResourceName(raw.name);
  if (
    !isValidProjectOrBoardId(raw.id) ||
    !isValidProjectOrBoardId(raw.projectId) ||
    !normalizedName
  ) {
    return null;
  }
  return { id: raw.id, projectId: raw.projectId, name: normalizedName.name };
}

/** Safely parses the workspace index from untrusted JSON. Malformed entries
 * are dropped individually (matching `normalizeCards`/`parseProjectList`
 * house style) rather than failing the whole index. */
export function parseWorkspaceIndex(raw: string | null): WorkspaceIndex {
  if (!raw) {
    return { projects: [], boards: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { projects: [], boards: [] };
    }
    const value = parsed as { projects?: unknown; boards?: unknown };
    const projects = Array.isArray(value.projects)
      ? value.projects.map(parseProjectIndexEntry).filter((entry): entry is LocalProjectIndexEntry => entry !== null)
      : [];
    const boards = Array.isArray(value.boards)
      ? value.boards.map(parseBoardIndexEntry).filter((entry): entry is LocalBoardIndexEntry => entry !== null)
      : [];
    return { projects, boards };
  } catch {
    return { projects: [], boards: [] };
  }
}

export function loadWorkspaceIndex(storage: StorageLike): WorkspaceIndex {
  return parseWorkspaceIndex(storage.getItem(WORKSPACE_INDEX_KEY));
}

export function saveWorkspaceIndex(storage: StorageLike, index: WorkspaceIndex): void {
  const parsed = parseWorkspaceIndex(JSON.stringify(index));
  if (
    parsed.projects.length !== index.projects.length ||
    parsed.boards.length !== index.boards.length
  ) {
    throw new Error("Workspace index 含有無效的 Project 或 Board metadata。");
  }
  storage.setItem(WORKSPACE_INDEX_KEY, JSON.stringify(index));
}

/** Adds/replaces one Project and one Board in the index, de-duplicating by
 * id so repeated calls (e.g. migration running twice) stay idempotent. */
export function upsertProjectAndBoard(
  index: WorkspaceIndex,
  project: LocalProjectIndexEntry,
  board: LocalBoardIndexEntry,
): WorkspaceIndex {
  return {
    projects: [...index.projects.filter((entry) => entry.id !== project.id), project],
    boards: [...index.boards.filter((entry) => entry.id !== board.id), board],
  };
}

// ---------------------------------------------------------------------------
// Active Board context
// ---------------------------------------------------------------------------

function parseActiveContext(value: unknown): BoardContext | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (
    !isValidWorkspaceId(raw.workspaceId) ||
    !isValidProjectOrBoardId(raw.projectId) ||
    !isValidProjectOrBoardId(raw.boardId)
  ) {
    return null;
  }
  return { workspaceId: raw.workspaceId, projectId: raw.projectId, boardId: raw.boardId };
}

export function loadActiveContext(storage: StorageLike): BoardContext | null {
  const raw = storage.getItem(ACTIVE_CONTEXT_KEY);
  if (!raw) {
    return null;
  }
  try {
    return parseActiveContext(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveActiveContext(storage: StorageLike, context: BoardContext): void {
  if (!parseActiveContext(context)) {
    throw new Error("Active Board context 含有無效的 resource ID。");
  }
  storage.setItem(ACTIVE_CONTEXT_KEY, JSON.stringify(context));
}

export function clearActiveContext(storage: StorageLike): void {
  storage.removeItem(ACTIVE_CONTEXT_KEY);
}

// ---------------------------------------------------------------------------
// Per-board content (BoardState)
// ---------------------------------------------------------------------------

export type LoadedBoard = {
  board: BoardState;
  recovered: boolean;
  error: string | null;
};

/** Reads and parses one Board's content, isolated by `boardId` (a UUID once
 * migrated to the server, or `LOCAL_LEGACY_BOARD_ID` pre-migration). Reuses
 * `parsePersistedBoard`'s safe fallback -- malformed content never throws. */
export function loadBoardState(storage: StorageLike, boardId: string): LoadedBoard {
  assertValidProjectOrBoardId(boardId, "boardId");
  return parsePersistedBoard(storage.getItem(boardContentKey(boardId)));
}

export function saveBoardState(storage: StorageLike, boardId: string, board: BoardState): void {
  assertValidProjectOrBoardId(boardId, "boardId");
  storage.setItem(boardContentKey(boardId), serializeBoard(board));
}

// ---------------------------------------------------------------------------
// Per-board sync revision
// ---------------------------------------------------------------------------

/** Reads this Board's last-known-synced revision, isolated by `boardId`.
 * Mirrors `loadSyncRevision` in app/sync/config.ts but per-board and against
 * an injectable `StorageLike` instead of the global `window.localStorage`. */
export function loadBoardRevision(storage: StorageLike, boardId: string): number {
  assertValidProjectOrBoardId(boardId, "boardId");
  const raw = storage.getItem(syncRevisionKey(boardId));
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function saveBoardRevision(storage: StorageLike, boardId: string, revision: number): void {
  assertValidProjectOrBoardId(boardId, "boardId");
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("Board revision 必須是大於或等於 0 的整數。");
  }
  storage.setItem(syncRevisionKey(boardId), String(revision));
}
