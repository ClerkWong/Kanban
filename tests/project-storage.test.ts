import assert from "node:assert/strict";
import test from "node:test";

import { createDemoBoard, serializeBoard } from "../app/board-model";
import { isServerResourceId } from "../app/projects/model";
import {
  ACTIVE_CONTEXT_KEY,
  boardContentKey,
  loadActiveContext,
  loadBoardRevision,
  loadBoardState,
  loadWorkspaceIndex,
  LOCAL_LEGACY_WORKSPACE_ID,
  parseWorkspaceIndex,
  saveActiveContext,
  saveBoardRevision,
  saveBoardState,
  saveWorkspaceIndex,
  syncRevisionKey,
  upsertProjectAndBoard,
  WORKSPACE_INDEX_KEY,
  type StorageLike,
} from "../app/projects/storage";

const UUID_PROJECT_A = "5f8d6f2e-2c2b-4c9a-8b1a-8b2f3c4d5e6f";
const UUID_BOARD_A = "a1b2c3d4-e5f6-4789-8abc-1234567890ab";
const UUID_BOARD_B = "11111111-2222-4333-8444-555555555555";

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
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

test("boardContentKey / syncRevisionKey build the exact per-board key strings", () => {
  assert.equal(boardContentKey(UUID_BOARD_A), `kanban-board-v1:${UUID_BOARD_A}`);
  assert.equal(syncRevisionKey(UUID_BOARD_A), `kanban-sync-revision-v2:${UUID_BOARD_A}`);
});

test("loadWorkspaceIndex returns an empty index when nothing is stored", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadWorkspaceIndex(storage), { projects: [], boards: [] });
});

test("parseWorkspaceIndex drops malformed entries but keeps well-formed ones", () => {
  const raw = JSON.stringify({
    projects: [
      { id: UUID_PROJECT_A, name: "正常專案" },
      { id: UUID_PROJECT_A, name: "" }, // blank name -> dropped
      { id: 123, name: "id 型別錯誤" }, // wrong id type -> dropped
      null,
    ],
    boards: [
      { id: UUID_BOARD_A, projectId: UUID_PROJECT_A, name: "正常看板" },
      { id: UUID_BOARD_B, projectId: 42, name: "projectId 型別錯誤" }, // dropped
    ],
  });

  const index = parseWorkspaceIndex(raw);
  assert.deepEqual(index.projects, [{ id: UUID_PROJECT_A, name: "正常專案" }]);
  assert.deepEqual(index.boards, [{ id: UUID_BOARD_A, projectId: UUID_PROJECT_A, name: "正常看板" }]);
});

test("parseWorkspaceIndex recovers to an empty index on malformed JSON", () => {
  assert.deepEqual(parseWorkspaceIndex("{not json"), { projects: [], boards: [] });
  assert.deepEqual(parseWorkspaceIndex(null), { projects: [], boards: [] });
});

test("saveWorkspaceIndex / loadWorkspaceIndex round trip through the exact storage key", () => {
  const storage = createMemoryStorage();
  const index = {
    projects: [{ id: UUID_PROJECT_A, name: "專案 A" }],
    boards: [{ id: UUID_BOARD_A, projectId: UUID_PROJECT_A, name: "看板 A" }],
  };
  saveWorkspaceIndex(storage, index);

  assert.ok(storage.getItem(WORKSPACE_INDEX_KEY));
  assert.deepEqual(loadWorkspaceIndex(storage), index);
});

test("upsertProjectAndBoard de-duplicates by id (idempotent re-upsert)", () => {
  const index = { projects: [], boards: [] };
  const once = upsertProjectAndBoard(
    index,
    { id: UUID_PROJECT_A, name: "專案 A" },
    { id: UUID_BOARD_A, projectId: UUID_PROJECT_A, name: "看板 A" },
  );
  const twice = upsertProjectAndBoard(
    once,
    { id: UUID_PROJECT_A, name: "專案 A（改名）" },
    { id: UUID_BOARD_A, projectId: UUID_PROJECT_A, name: "看板 A（改名）" },
  );

  assert.equal(twice.projects.length, 1);
  assert.equal(twice.boards.length, 1);
  assert.equal(twice.projects[0].name, "專案 A（改名）");
  assert.equal(twice.boards[0].name, "看板 A（改名）");
});

test("active context round trips and rejects malformed shapes", () => {
  const storage = createMemoryStorage();
  assert.equal(loadActiveContext(storage), null);

  const context = { workspaceId: LOCAL_LEGACY_WORKSPACE_ID, projectId: UUID_PROJECT_A, boardId: UUID_BOARD_A };
  saveActiveContext(storage, context);
  assert.ok(storage.getItem(ACTIVE_CONTEXT_KEY));
  assert.deepEqual(loadActiveContext(storage), context);

  storage.setItem(ACTIVE_CONTEXT_KEY, JSON.stringify({ workspaceId: "not-a-uuid-or-placeholder", projectId: UUID_PROJECT_A, boardId: UUID_BOARD_A }));
  assert.equal(loadActiveContext(storage), null);

  storage.setItem(ACTIVE_CONTEXT_KEY, "{not json");
  assert.equal(loadActiveContext(storage), null);
});

test("loadBoardState uses parsePersistedBoard's safe fallback for malformed content", () => {
  const storage = createMemoryStorage();
  storage.setItem(boardContentKey(UUID_BOARD_A), "{not json");
  const result = loadBoardState(storage, UUID_BOARD_A);
  assert.equal(result.recovered, true);
  assert.ok(result.error);
  assert.ok(result.board.columns.length > 0);
});

test("saveBoardState / loadBoardState round trip a real board", () => {
  const storage = createMemoryStorage();
  const board = createDemoBoard(new Date(2026, 6, 10));
  saveBoardState(storage, UUID_BOARD_A, board);

  assert.equal(storage.getItem(boardContentKey(UUID_BOARD_A)), serializeBoard(board));
  const loaded = loadBoardState(storage, UUID_BOARD_A);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.board.columns, board.columns);
});

test("saveBoardRevision / loadBoardRevision round trip and reject invalid values", () => {
  const storage = createMemoryStorage();
  assert.equal(loadBoardRevision(storage, UUID_BOARD_A), 0);

  saveBoardRevision(storage, UUID_BOARD_A, 7);
  assert.equal(storage.getItem(syncRevisionKey(UUID_BOARD_A)), "7");
  assert.equal(loadBoardRevision(storage, UUID_BOARD_A), 7);

  storage.setItem(syncRevisionKey(UUID_BOARD_A), "not-a-number");
  assert.equal(loadBoardRevision(storage, UUID_BOARD_A), 0);

  storage.setItem(syncRevisionKey(UUID_BOARD_A), "-3");
  assert.equal(loadBoardRevision(storage, UUID_BOARD_A), 0);
});

test("switching the active Board keeps Board A and Board B fully isolated", () => {
  const storage = createMemoryStorage();

  const boardA = createDemoBoard(new Date(2026, 6, 10));
  const boardB = createDemoBoard(new Date(2026, 6, 11));
  // Give B distinct content so a content leak between boards is detectable.
  boardB.labels = [{ id: "only-in-b", name: "只在 B", color: "#000000" }];

  saveBoardState(storage, UUID_BOARD_A, boardA);
  saveBoardState(storage, UUID_BOARD_B, boardB);
  saveBoardRevision(storage, UUID_BOARD_A, 3);
  saveBoardRevision(storage, UUID_BOARD_B, 9);

  // Distinct underlying keys.
  assert.notEqual(boardContentKey(UUID_BOARD_A), boardContentKey(UUID_BOARD_B));
  assert.notEqual(syncRevisionKey(UUID_BOARD_A), syncRevisionKey(UUID_BOARD_B));

  // No shared content.
  const loadedA = loadBoardState(storage, UUID_BOARD_A);
  const loadedB = loadBoardState(storage, UUID_BOARD_B);
  assert.deepEqual(loadedA.board.labels, boardA.labels);
  assert.deepEqual(loadedB.board.labels, boardB.labels);
  assert.notDeepEqual(loadedA.board.labels, loadedB.board.labels);

  // No shared revision.
  assert.equal(loadBoardRevision(storage, UUID_BOARD_A), 3);
  assert.equal(loadBoardRevision(storage, UUID_BOARD_B), 9);

  // Switching the active context to B does not mutate A's stored state.
  saveActiveContext(storage, {
    workspaceId: LOCAL_LEGACY_WORKSPACE_ID,
    projectId: UUID_PROJECT_A,
    boardId: UUID_BOARD_B,
  });
  assert.deepEqual(loadBoardState(storage, UUID_BOARD_A).board.labels, boardA.labels);
  assert.equal(loadBoardRevision(storage, UUID_BOARD_A), 3);
});

test("LOCAL_LEGACY_WORKSPACE_ID never validates as a server resource id", () => {
  assert.equal(isServerResourceId(LOCAL_LEGACY_WORKSPACE_ID), false);
});
