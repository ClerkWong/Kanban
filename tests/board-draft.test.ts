import assert from "node:assert/strict";
import test from "node:test";
import {
  createDraft,
  draftFromCard,
  draftToCardInput,
  findNearestFocus,
  locateCard,
} from "../app/components/board/shared";
import { createDemoBoard } from "../app/board-model";

test("createDraft 以空白欄位與中優先級起始", () => {
  const draft = createDraft();
  assert.equal(draft.title, "");
  assert.equal(draft.priority, "medium");
  assert.deepEqual(draft.labelIds, []);
  assert.deepEqual(draft.checklist, []);
});

test("draftFromCard 複製欄位並以逗號串接成員、深拷貝清單", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const card = board.cards["card-roadmap"];
  const draft = draftFromCard(card);
  assert.equal(draft.title, card.title);
  assert.equal(draft.members, card.members.join(", "));
  assert.notEqual(draft.checklist, card.checklist);
  assert.notEqual(draft.checklist[0], card.checklist[0]);
});

test("draftToCardInput 修剪成員字串並剔除空項", () => {
  const draft = { ...createDraft(), members: " 雅婷 , , Kai " };
  const input = draftToCardInput(draft);
  assert.deepEqual(input.members, ["雅婷", "Kai"]);
});

test("locateCard 回傳欄與卡索引，找不到回傳 null", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const position = locateCard(board, "card-roadmap");
  assert.ok(position);
  assert.equal(typeof position.columnIndex, "number");
  assert.equal(board.columns[position.columnIndex].cardIds[position.cardIndex], "card-roadmap");
  assert.equal(locateCard(board, "card-不存在"), null);
});

test("findNearestFocus 優先取同欄下一張，否則上一張，否則 null", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const column = board.columns.find((entry) => entry.cardIds.length >= 2);
  assert.ok(column);
  const [first, second] = column.cardIds;
  assert.equal(findNearestFocus(board.columns, first), second);
  assert.equal(findNearestFocus(board.columns, "card-不存在"), null);
});
