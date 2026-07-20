import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBoardInvariants,
  createDemoBoard,
  deleteCard,
  moveCard,
  updateCard,
} from "../app/board-model";
import { mergeBoards } from "../app/sync/merge";

function later(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

test("卡片級 LWW：較新的 updatedAt 獲勝", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const a = updateCard(base, "card-roadmap", { title: "A 版標題" });
  const b = updateCard(base, "card-roadmap", { title: "B 版標題" });
  const bNewer = {
    ...b,
    cards: {
      ...b.cards,
      "card-roadmap": {
        ...b.cards["card-roadmap"],
        updatedAt: later(a.cards["card-roadmap"].updatedAt, 5000),
      },
    },
  };
  const merged = mergeBoards(a, bNewer);
  assert.equal(merged.cards["card-roadmap"].title, "B 版標題");
  assertBoardInvariants(merged);
});

test("較新的刪除擊敗較舊的編輯（不復活）", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const edited = updateCard(base, "card-copy", { title: "編輯過" });
  const deleted = deleteCard(base, "card-copy");
  const deletedNewer = {
    ...deleted,
    deletedCards: {
      ...deleted.deletedCards,
      "card-copy": later(edited.cards["card-copy"].updatedAt, 5000),
    },
  };
  const merged = mergeBoards(edited, deletedNewer);
  assert.equal(merged.cards["card-copy"], undefined);
  assert.equal(typeof merged.deletedCards["card-copy"], "string");
});

test("較新的編輯擊敗較舊的刪除（復活並清墓碑）", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const deleted = deleteCard(base, "card-copy");
  const edited = updateCard(base, "card-copy", { title: "復活" });
  const editedNewer = {
    ...edited,
    cards: {
      ...edited.cards,
      "card-copy": {
        ...edited.cards["card-copy"],
        updatedAt: later(deleted.deletedCards["card-copy"], 5000),
      },
    },
  };
  const merged = mergeBoards(deleted, editedNewer);
  assert.equal(merged.cards["card-copy"].title, "復活");
  assert.equal(merged.deletedCards["card-copy"], undefined);
});

test("欄位結構以 lastSavedAt 較新一方為準，另一方獨有卡片放回其原欄", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const moved = moveCard(base, "card-roadmap", "doing", 0);
  const withNew = updateCard(
    { ...base, lastSavedAt: later(moved.lastSavedAt, -60000) },
    "card-review",
    { title: "舊側編輯" },
  );
  const onlyInOld = {
    ...withNew,
    lastSavedAt: later(moved.lastSavedAt, -60000),
  };
  const merged = mergeBoards(moved, onlyInOld);
  const doing = merged.columns.find((column) => column.id === "doing");
  assert.ok(doing?.cardIds.includes("card-roadmap"));
  assertBoardInvariants(merged);
});

test("合併結果通過不變量且冪等", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const a = deleteCard(updateCard(base, "card-roadmap", { title: "X" }), "card-done");
  const b = moveCard(updateCard(base, "card-copy", { priority: "high" }), "card-review", "done", 0);
  const merged = mergeBoards(a, b);
  assertBoardInvariants(merged);
  const again = mergeBoards(merged, merged);
  assert.deepEqual(
    { cards: Object.keys(again.cards).sort(), deleted: Object.keys(again.deletedCards).sort() },
    { cards: Object.keys(merged.cards).sort(), deleted: Object.keys(merged.deletedCards).sort() },
  );
});
