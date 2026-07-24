import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  addCard,
  createDemoBoard,
  deleteCard,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
} from "../app/board-model";

test("schema 版本為 4 且示範看板墓碑為空", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 4);
  assert.deepEqual(createDemoBoard(new Date(2026, 6, 20)).deletedCards, {});
});

test("刪除卡片會記墓碑，重加同 id 會清墓碑", () => {
  const board = createDemoBoard(new Date(2026, 6, 20));
  const deleted = deleteCard(board, "card-roadmap");
  assert.equal(typeof deleted.deletedCards["card-roadmap"], "string");
  assert.equal(deleted.cards["card-roadmap"], undefined);

  const revived = addCard(deleted, "todo", { id: "card-roadmap", title: "重生" });
  assert.equal(revived.deletedCards["card-roadmap"], undefined);
  assert.equal(revived.cards["card-roadmap"].title, "重生");
});

test("v1、v2、v3 資料安全遷移為 v4，推定舊完成卡的 completedAt", () => {
  for (const version of [1, 2, 3]) {
    const legacy = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 20))));
    legacy.version = version;
    delete legacy.cards["card-done"].completedAt;
    if (version < 3) {
      delete legacy.deletedCards;
    }
    if (version === 1) {
      delete legacy.cards["card-done"].attachments;
    }

    const parsed = parsePersistedBoard(JSON.stringify(legacy));
    assert.equal(parsed.error, null);
    assert.equal(parsed.board.version, 4);
    assert.deepEqual(parsed.board.deletedCards, {});
    assert.equal(
      parsed.board.cards["card-done"].completedAt,
      parsed.board.cards["card-done"].updatedAt,
    );
    assert.equal(parsed.board.cards["card-roadmap"].completedAt, null);
  }
});

test("normalizeBoard 修剪逾期墓碑與卡片仍存在的墓碑", () => {
  const board = createDemoBoard(new Date(2026, 6, 20));
  const recent = new Date().toISOString();
  const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const dirty = {
    ...board,
    deletedCards: {
      "card-gone": recent,
      "card-ancient": stale,
      "card-roadmap": recent,
      "card-bad": 123 as unknown as string,
    },
  };
  const normalized = normalizeBoard(dirty);
  assert.deepEqual(Object.keys(normalized.deletedCards), ["card-gone"]);
});
