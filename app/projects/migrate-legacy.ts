// One-time, idempotent migration from the legacy single-board local storage
// (`kanban-pwa-board-v1`, see app/board-model.ts) into the new per-board
// storage layer (app/projects/storage.ts) under the local-only placeholder
// Project/Board IDs -- see design spec §17.3 and
// docs/superpowers/sdd/task-2-brief.md.
//
// Placeholder IDs (`LOCAL_LEGACY_PROJECT_ID`, `LOCAL_LEGACY_BOARD_ID`,
// `LOCAL_LEGACY_WORKSPACE_ID`) are LOCAL-ONLY and must never be sent to an
// API as if they were real, server-issued resource identifiers -- callers
// crossing that boundary must still gate on `isServerResourceId`.

import { parsePersistedBoard, serializeBoard, STORAGE_KEY } from "../board-model";
import { LOCAL_LEGACY_BOARD_ID, LOCAL_LEGACY_PROJECT_ID } from "./model";
import type { BoardContext } from "./types";
import {
  boardContentKey,
  loadActiveContext,
  loadWorkspaceIndex,
  LOCAL_LEGACY_WORKSPACE_ID,
  saveActiveContext,
  saveWorkspaceIndex,
  syncRevisionKey,
  upsertProjectAndBoard,
  type StorageLike,
} from "./storage";

const LEGACY_PROJECT_NAME = "舊版看板";
const LEGACY_BOARD_NAME = "舊版看板";

export type MigrationResult =
  /** No legacy data and nothing migrated yet -- a genuinely fresh install. */
  | { status: "not-needed" }
  /** Migration already ran (or a new-format Board already exists) --
   * nothing was written this call. */
  | { status: "already-migrated"; context: BoardContext }
  /** Legacy data was copied into the new per-board key. `warning` carries
   * forward `parsePersistedBoard`'s recovered-fallback error message (e.g.
   * malformed legacy JSON), or `null` when the legacy data parsed cleanly. */
  | { status: "migrated"; context: BoardContext; warning: string | null }
  /** Migration could not be safely completed. The legacy key is left
   * untouched; no new-format keys were written. */
  | { status: "error"; message: string };

/** The `BoardContext` produced once the legacy local board is migrated (or
 * detected as already migrated). Exposed so callers can build the context
 * without re-deriving the placeholder IDs themselves. */
export const LEGACY_BOARD_CONTEXT: BoardContext = {
  workspaceId: LOCAL_LEGACY_WORKSPACE_ID,
  projectId: LOCAL_LEGACY_PROJECT_ID,
  boardId: LOCAL_LEGACY_BOARD_ID,
};

/** Detects the legacy `kanban-pwa-board-v1` key and, if present and not yet
 * migrated, copies its content into `kanban-board-v1:{LOCAL_LEGACY_BOARD_ID}`
 * (verifying a serialize round trip first), registers the legacy
 * Project/Board in the workspace index, and -- only if no active context is
 * already set -- makes it the active context.
 *
 * Idempotent: once the new-format board content key exists, every
 * subsequent call is a no-op that returns `"already-migrated"` without
 * touching the index, the active context, or the legacy key.
 *
 * Copy-then-keep: the legacy key is never deleted or modified by this
 * function, regardless of outcome.
 */
export function migrateLegacyBoard(storage: StorageLike): MigrationResult {
  try {
    // Idempotency guard: new-format content already present means migration
    // already ran (or this install already started on the new format).
    if (storage.getItem(boardContentKey(LOCAL_LEGACY_BOARD_ID)) !== null) {
      return { status: "already-migrated", context: LEGACY_BOARD_CONTEXT };
    }

    const legacyRaw = storage.getItem(STORAGE_KEY);
    if (legacyRaw === null) {
      return { status: "not-needed" };
    }

    // parsePersistedBoard never throws: malformed legacy JSON safely falls
    // back to a demo board plus a human-readable (zh-Hant) error string.
    const { board, error } = parsePersistedBoard(legacyRaw);

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
    storage.setItem(boardContentKey(LOCAL_LEGACY_BOARD_ID), serialized);
    storage.setItem(syncRevisionKey(LOCAL_LEGACY_BOARD_ID), "0");

    const nextIndex = upsertProjectAndBoard(
      loadWorkspaceIndex(storage),
      { id: LOCAL_LEGACY_PROJECT_ID, name: LEGACY_PROJECT_NAME },
      { id: LOCAL_LEGACY_BOARD_ID, projectId: LOCAL_LEGACY_PROJECT_ID, name: LEGACY_BOARD_NAME },
    );
    saveWorkspaceIndex(storage, nextIndex);

    // Only set the active context if none exists yet -- never override a
    // context the user (or a later migration step) may already have set.
    if (loadActiveContext(storage) === null) {
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
