// One-time, idempotent migration from the legacy single-board local storage
// (`kanban-pwa-board-v1`, see app/board-model.ts) into the new per-board
// storage layer (app/projects/storage.ts) under the local-only placeholder
// Project/Board IDs -- see design spec §17.3 and
// the multi-project implementation plan, Task 2.
//
// Placeholder IDs (`LOCAL_LEGACY_PROJECT_ID`, `LOCAL_LEGACY_BOARD_ID`,
// `LOCAL_LEGACY_WORKSPACE_ID`) are LOCAL-ONLY and must never be sent to an
// API as if they were real, server-issued resource identifiers -- callers
// crossing that boundary must still gate on `isServerResourceId`.

import { parsePersistedBoard, serializeBoard, STORAGE_KEY } from "../board-model";
import type { BoardState } from "../board-model";
import { mergeBoards } from "../sync/merge";
import { LOCAL_LEGACY_BOARD_ID, LOCAL_LEGACY_PROJECT_ID } from "./model";
import type { BoardContext } from "./types";
import {
  boardContentKey,
  loadActiveContext,
  loadWorkspaceIndex,
  LOCAL_LEGACY_WORKSPACE_ID,
  saveActiveContext,
  saveBoardRevision,
  saveBoardState,
  saveWorkspaceIndex,
  syncRevisionKey,
  upsertProjectAndBoard,
  type StorageLike,
} from "./storage";

const LEGACY_PROJECT_NAME = "舊版看板";
const LEGACY_BOARD_NAME = "舊版看板";
export const LEGACY_BACKUP_KEY = "kanban-legacy-backup-v1";
export const LEGACY_SERVER_ADOPTION_KEY = "kanban-legacy-server-adoption-v1";

export type ServerMigrationChoice = "merge" | "remote";

export type LegacyBackup = {
  exportedAt: string;
  source: "legacy-local";
  board: BoardState;
};

export type MigrationResult =
  /** No legacy data and nothing migrated yet -- a genuinely fresh install. */
  | { status: "not-needed" }
  /** Migration already ran and every required new-format record exists. */
  | { status: "already-migrated"; context: BoardContext }
  /** Legacy data was copied into the new per-board key. `warning` carries
   * forward `parsePersistedBoard`'s recovered-fallback error message (e.g.
   * malformed legacy JSON), or `null` when the legacy data parsed cleanly. */
  | { status: "migrated"; context: BoardContext; warning: string | null }
  /** Migration could not be safely completed. The legacy key is left
   * untouched. A retry may repair harmless partial new-format writes. */
  | { status: "error"; message: string };

/** The `BoardContext` produced once the legacy local board is migrated (or
 * detected as already migrated). Exposed so callers can build the context
 * without re-deriving the placeholder IDs themselves. */
export const LEGACY_BOARD_CONTEXT: BoardContext = {
  workspaceId: LOCAL_LEGACY_WORKSPACE_ID,
  projectId: LOCAL_LEGACY_PROJECT_ID,
  boardId: LOCAL_LEGACY_BOARD_ID,
};

export const SERVER_LEGACY_CONTEXT: BoardContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000003",
  boardId: "00000000-0000-4000-8000-000000000004",
};

export function hasLocalLegacyBoard(storage: StorageLike): boolean {
  return storage.getItem(STORAGE_KEY) !== null ||
    storage.getItem(boardContentKey(LOCAL_LEGACY_BOARD_ID)) !== null;
}

export function needsServerLegacyChoice(
  storage: StorageLike,
  context: BoardContext,
): boolean {
  return hasLocalLegacyBoard(storage) &&
    storage.getItem(LEGACY_SERVER_ADOPTION_KEY) !==
      `${context.workspaceId}/${context.projectId}/${context.boardId}`;
}

export function markServerLegacyAdopted(
  storage: StorageLike,
  context: BoardContext,
): void {
  storage.setItem(
    LEGACY_SERVER_ADOPTION_KEY,
    `${context.workspaceId}/${context.projectId}/${context.boardId}`,
  );
}

export function loadLegacyBackup(storage: StorageLike): LegacyBackup | null {
  const raw = storage.getItem(LEGACY_BACKUP_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LegacyBackup>;
    const parsed = parsePersistedBoard(JSON.stringify(value.board));
    return value.source === "legacy-local" &&
      typeof value.exportedAt === "string" &&
      !parsed.recovered
      ? { exportedAt: value.exportedAt, source: "legacy-local", board: parsed.board }
      : null;
  } catch {
    return null;
  }
}

/** Applies an explicit local-vs-remote choice. The original local board is
 * backed up once and never overwritten by later retries. */
export function adoptServerLegacyBoard(
  storage: StorageLike,
  context: BoardContext,
  remoteBoard: BoardState,
  remoteRevision: number,
  choice: ServerMigrationChoice,
  now = new Date(),
): { board: BoardState; backup: LegacyBackup } {
  const localRaw =
    storage.getItem(boardContentKey(LOCAL_LEGACY_BOARD_ID)) ??
    storage.getItem(STORAGE_KEY);
  const local = parsePersistedBoard(localRaw).board;
  const existingBackup = loadLegacyBackup(storage);
  const backup = existingBackup ?? {
    exportedAt: now.toISOString(),
    source: "legacy-local" as const,
    board: local,
  };
  if (!existingBackup) {
    storage.setItem(LEGACY_BACKUP_KEY, JSON.stringify(backup));
  }
  const board = choice === "merge" ? mergeBoards(local, remoteBoard) : remoteBoard;
  const verified = parsePersistedBoard(serializeBoard(board));
  if (verified.recovered) throw new Error("遷移後的看板無法安全序列化。");
  saveBoardState(storage, context.boardId, verified.board);
  saveBoardRevision(storage, context.boardId, remoteRevision);
  saveActiveContext(storage, context);
  return { board: verified.board, backup };
}

/** Detects the legacy `kanban-pwa-board-v1` key and, if present and not yet
 * migrated, copies its content into `kanban-board-v1:{LOCAL_LEGACY_BOARD_ID}`
 * (verifying a serialize round trip first), registers the legacy
 * Project/Board in the workspace index, and -- only if no active context is
 * already set -- makes it the active context.
 *
 * Idempotent and repairable: a call only returns `"already-migrated"` when
 * Board content, revision, and index metadata are all present. If a prior
 * localStorage write failed halfway through, the next call fills in the
 * missing records without duplicating Project/Board entries or replacing a
 * later active-context choice.
 *
 * Copy-then-keep: the legacy key is never deleted or modified by this
 * function, regardless of outcome.
 */
export function migrateLegacyBoard(storage: StorageLike): MigrationResult {
  try {
    const contentKey = boardContentKey(LOCAL_LEGACY_BOARD_ID);
    const existingNewRaw = storage.getItem(contentKey);
    const legacyRaw = storage.getItem(STORAGE_KEY);
    if (existingNewRaw === null && legacyRaw === null) {
      return { status: "not-needed" };
    }

    const index = loadWorkspaceIndex(storage);
    const hasProject = index.projects.some(({ id }) => id === LOCAL_LEGACY_PROJECT_ID);
    const hasBoard = index.boards.some(
      ({ id, projectId }) =>
        id === LOCAL_LEGACY_BOARD_ID && projectId === LOCAL_LEGACY_PROJECT_ID,
    );
    const hasRevision = storage.getItem(
      syncRevisionKey(LOCAL_LEGACY_BOARD_ID),
    ) !== null;
    const activeContext = loadActiveContext(storage);

    if (
      existingNewRaw !== null &&
      hasProject &&
      hasBoard &&
      hasRevision &&
      activeContext !== null
    ) {
      const existing = parsePersistedBoard(existingNewRaw);
      if (!existing.error) {
        return { status: "already-migrated", context: LEGACY_BOARD_CONTEXT };
      }
    }

    // Prefer valid new-format content when repairing an interrupted
    // migration. Otherwise rebuild it from the preserved legacy key.
    const existingNew = existingNewRaw === null ? null : parsePersistedBoard(existingNewRaw);
    const source =
      existingNew && !existingNew.error
        ? existingNew
        : legacyRaw === null
          ? null
          : parsePersistedBoard(legacyRaw);
    if (!source) {
      return {
        status: "error",
        message: "新版看板資料不完整，且找不到可用的舊版資料進行修復。",
      };
    }
    const { board, error } = source;

    // Verify the serialize round trip before writing anything new-format --
    // if the parsed board cannot itself survive a serialize/parse cycle,
    // abort without writing (legacy key stays authoritative).
    const serialized = serializeBoard(board);
    const roundTripped = parsePersistedBoard(serialized);
    if (roundTripped.error) {
      return {
        status: "error",
        message: "本機看板資料無法安全遷移，已保留舊版資料，未建立新版看板。",
      };
    }

    // Copy-then-keep: write the new per-board key(s); never delete or
    // otherwise touch the legacy key here.
    saveBoardState(storage, LOCAL_LEGACY_BOARD_ID, board);
    const written = parsePersistedBoard(storage.getItem(contentKey));
    if (written.error) {
      return {
        status: "error",
        message: "新版看板寫入後驗證失敗，已保留舊版資料。",
      };
    }
    if (!hasRevision) {
      saveBoardRevision(storage, LOCAL_LEGACY_BOARD_ID, 0);
    }

    const nextIndex = upsertProjectAndBoard(
      index,
      { id: LOCAL_LEGACY_PROJECT_ID, name: LEGACY_PROJECT_NAME },
      { id: LOCAL_LEGACY_BOARD_ID, projectId: LOCAL_LEGACY_PROJECT_ID, name: LEGACY_BOARD_NAME },
    );
    saveWorkspaceIndex(storage, nextIndex);

    // Only set the active context if none exists yet -- never override a
    // context the user (or a later migration step) may already have set.
    if (activeContext === null) {
      saveActiveContext(storage, LEGACY_BOARD_CONTEXT);
    }

    return { status: "migrated", context: LEGACY_BOARD_CONTEXT, warning: error };
  } catch (thrown) {
    return {
      status: "error",
      message: thrown instanceof Error ? thrown.message : "本機看板遷移時發生未知錯誤。",
    };
  }
}
