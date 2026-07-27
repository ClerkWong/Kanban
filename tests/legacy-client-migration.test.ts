import assert from "node:assert/strict";
import test from "node:test";
import { addCard, createDemoBoard, serializeBoard, STORAGE_KEY } from "../app/board-model";
import {
  LEGACY_BACKUP_KEY,
  adoptServerLegacyBoard,
  hasLocalLegacyBoard,
  loadLegacyBackup,
  markServerLegacyAdopted,
  needsServerLegacyChoice,
} from "../app/projects/migrate-legacy";
import { loadActiveContext, loadBoardRevision, loadBoardState, type StorageLike } from "../app/projects/storage";
import {
  buildLegacyCopySql,
  buildLegacyFailureSql,
  buildLegacyLockSql,
} from "../scripts/migrate-legacy-board";
import {
  fingerprint,
  verifyMigration,
} from "../scripts/verify-multi-project-migration";

function memory(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const context = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000003",
  boardId: "00000000-0000-4000-8000-000000000004",
};

test("detects legacy local data and explicit remote adoption preserves a one-time backup", () => {
  const local = addCard(createDemoBoard(), "col-backlog", { id: "local-only", title: "Local" });
  const remote = addCard(createDemoBoard(), "col-backlog", { id: "remote-only", title: "Remote" });
  const storage = memory({ [STORAGE_KEY]: serializeBoard(local) });
  assert.equal(hasLocalLegacyBoard(storage), true);
  const result = adoptServerLegacyBoard(storage, context, remote, 7, "remote");
  assert.ok(result.board.cards["remote-only"]);
  assert.equal(result.board.cards["local-only"], undefined);
  assert.ok(loadLegacyBackup(storage)?.board.cards["local-only"]);
  assert.equal(loadBoardRevision(storage, context.boardId), 7);
  assert.deepEqual(loadActiveContext(storage), context);
  assert.equal(needsServerLegacyChoice(storage, context), true);
  markServerLegacyAdopted(storage, context);
  assert.equal(needsServerLegacyChoice(storage, context), false);

  const savedBackup = storage.getItem(LEGACY_BACKUP_KEY);
  adoptServerLegacyBoard(storage, context, createDemoBoard(), 8, "remote");
  assert.equal(storage.getItem(LEGACY_BACKUP_KEY), savedBackup);
});

test("merge choice uses card-level merge and writes only the server Board key", () => {
  const local = addCard(createDemoBoard(), "col-backlog", { id: "local-only", title: "Local" });
  const remote = addCard(createDemoBoard(), "col-backlog", { id: "remote-only", title: "Remote" });
  const storage = memory({ [STORAGE_KEY]: serializeBoard(local) });
  const result = adoptServerLegacyBoard(storage, context, remote, 3, "merge");
  assert.ok(result.board.cards["local-only"]);
  assert.ok(result.board.cards["remote-only"]);
  assert.ok(loadBoardState(storage, context.boardId).board.cards["local-only"]);
  assert.equal(storage.getItem(STORAGE_KEY), serializeBoard(local));
});

test("server migration SQL locks first, copies the latest row, and has a pending rollback", () => {
  assert.match(buildLegacyLockSql(), /status = 'locked'/);
  const copy = buildLegacyCopySql("a0000000-0000-4000-8000-000000000001");
  assert.match(copy, /FROM board WHERE id = 1/);
  assert.ok(copy.indexOf("INSERT INTO boards") < copy.indexOf("status = 'complete'"));
  assert.match(buildLegacyFailureSql(), /status = 'pending'/);
});

test("verification fingerprints counts without descriptions or tokens", () => {
  const board = createDemoBoard();
  const value = fingerprint(board, 4);
  assert.deepEqual(verifyMigration(value, { ...value }), []);
  assert.deepEqual(verifyMigration(value, { ...value, revision: 5 }), ["revision mismatch"]);
  assert.equal("description" in value, false);
  assert.equal("token" in value, false);
});
