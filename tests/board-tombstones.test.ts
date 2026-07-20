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

test("schema 版本為 3 且示範看板墓碑為空", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 3);
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

test("v2 資料無錯遷移為 v3，補上空墓碑", () => {
  const v2 = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 20))));
  v2.version = 2;
  delete v2.deletedCards;
  const parsed = parsePersistedBoard(JSON.stringify(v2));
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 3);
  assert.deepEqual(parsed.board.deletedCards, {});
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
