import assert from "node:assert/strict";
import test from "node:test";

import { createDemoBoard, serializeBoard, STORAGE_KEY } from "../app/board-model";
import { isServerResourceId, LOCAL_LEGACY_BOARD_ID, LOCAL_LEGACY_PROJECT_ID } from "../app/projects/model";
import { LEGACY_BOARD_CONTEXT, migrateLegacyBoard } from "../app/projects/migrate-legacy";
import {
  boardContentKey,
  loadActiveContext,
  loadBoardRevision,
  loadBoardState,
  loadWorkspaceIndex,
  LOCAL_LEGACY_WORKSPACE_ID,
  saveActiveContext,
  syncRevisionKey,
  type StorageLike,
} from "../app/projects/storage";

const UUID_PROJECT = "5f8d6f2e-2c2b-4c9a-8b1a-8b2f3c4d5e6f";
const UUID_BOARD = "a1b2c3d4-e5f6-4789-8abc-1234567890ab";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test("no legacy key and no prior migration -> not-needed, nothing written", () => {
  const storage = createMemoryStorage();
  const result = migrateLegacyBoard(storage);
  assert.deepEqual(result, { status: "not-needed" });
  assert.equal(storage.getItem(boardContentKey(LOCAL_LEGACY_BOARD_ID)), null);
  assert.equal(loadActiveContext(storage), null);
});

test("migrates a well-formed legacy board into the new per-board key", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const storage = createMemoryStorage({ [STORAGE_KEY]: serializeBoard(board) });

  const result = migrateLegacyBoard(storage);
  assert.equal(result.status, "migrated");
  if (result.status !== "migrated") throw new Error("unreachable");
  assert.equal(result.warning, null);
  assert.deepEqual(result.context, LEGACY_BOARD_CONTEXT);

  // Legacy key preserved (copy-then-keep, never deleted).
  assert.equal(storage.getItem(STORAGE_KEY), serializeBoard(board));

  // New per-board content matches, under the placeholder Board ID.
  const migratedBoard = loadBoardState(storage, LOCAL_LEGACY_BOARD_ID);
  assert.equal(migratedBoard.error, null);
  assert.deepEqual(migratedBoard.board.columns, board.columns);

  // Fresh unsynced revision.
  assert.equal(loadBoardRevision(storage, LOCAL_LEGACY_BOARD_ID), 0);

  // Workspace index registers the legacy Project + Board.
  const index = loadWorkspaceIndex(storage);
  assert.ok(index.projects.some((project) => project.id === LOCAL_LEGACY_PROJECT_ID));
  assert.ok(
    index.boards.some(
      (b) => b.id === LOCAL_LEGACY_BOARD_ID && b.projectId === LOCAL_LEGACY_PROJECT_ID,
    ),
  );

  // Active context set to the legacy context since none existed before.
  assert.deepEqual(loadActiveContext(storage), LEGACY_BOARD_CONTEXT);
});

test("placeholder IDs never validate as server resource IDs", () => {
  assert.equal(isServerResourceId(LOCAL_LEGACY_PROJECT_ID), false);
  assert.equal(isServerResourceId(LOCAL_LEGACY_BOARD_ID), false);
  assert.equal(isServerResourceId(LOCAL_LEGACY_WORKSPACE_ID), false);
});

test("malformed legacy JSON falls back to a demo board and surfaces a warning instead of throwing", () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: "{not valid json" });

  const result = migrateLegacyBoard(storage);
  assert.equal(result.status, "migrated");
  if (result.status !== "migrated") throw new Error("unreachable");
  assert.ok(result.warning);
  assert.match(result.warning, /本機資料|示範資料/);

  // Migration still completed with the safe fallback content.
  const migratedBoard = loadBoardState(storage, LOCAL_LEGACY_BOARD_ID);
  assert.equal(migratedBoard.error, null);
  assert.ok(migratedBoard.board.columns.length > 0);

  // Legacy (malformed) key is preserved untouched.
  assert.equal(storage.getItem(STORAGE_KEY), "{not valid json");
});

test("running migration twice is idempotent: no duplicate Project/Board entries, no clobbering", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const storage = createMemoryStorage({ [STORAGE_KEY]: serializeBoard(board) });

  const first = migrateLegacyBoard(storage);
  assert.equal(first.status, "migrated");

  // Simulate the user switching boards after the first migration.
  const otherContext = { workspaceId: LOCAL_LEGACY_WORKSPACE_ID, projectId: UUID_PROJECT, boardId: UUID_BOARD };
  saveActiveContext(storage, otherContext);

  const second = migrateLegacyBoard(storage);
  assert.deepEqual(second, { status: "already-migrated", context: LEGACY_BOARD_CONTEXT });

  // Index has exactly one legacy Project and one legacy Board -- no duplicates.
  const index = loadWorkspaceIndex(storage);
  assert.equal(index.projects.filter((p) => p.id === LOCAL_LEGACY_PROJECT_ID).length, 1);
  assert.equal(index.boards.filter((b) => b.id === LOCAL_LEGACY_BOARD_ID).length, 1);

  // Re-running migration did not clobber the user's subsequent active-context switch.
  assert.deepEqual(loadActiveContext(storage), otherContext);

  // Legacy key still preserved.
  assert.equal(storage.getItem(STORAGE_KEY), serializeBoard(board));
});

test("does not delete the legacy key before/after a successful migration", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const raw = serializeBoard(board);
  const storage = createMemoryStorage({ [STORAGE_KEY]: raw });

  migrateLegacyBoard(storage);
  assert.equal(storage.getItem(STORAGE_KEY), raw);

  migrateLegacyBoard(storage);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
});

test("new per-board content key already present (already-migrated) leaves everything untouched", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const storage = createMemoryStorage({
    [STORAGE_KEY]: serializeBoard(board),
    [boardContentKey(LOCAL_LEGACY_BOARD_ID)]: serializeBoard(board),
  });
  // The already-migrated branch must not require a revision key to pre-exist.
  assert.equal(storage.getItem(syncRevisionKey(LOCAL_LEGACY_BOARD_ID)), null);

  const result = migrateLegacyBoard(storage);
  assert.deepEqual(result, { status: "already-migrated", context: LEGACY_BOARD_CONTEXT });
  assert.equal(loadWorkspaceIndex(storage).projects.length, 0);
  assert.equal(loadActiveContext(storage), null);
});
