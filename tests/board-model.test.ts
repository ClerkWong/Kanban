import assert from "node:assert/strict";
import test from "node:test";
import {
  addCard,
  assertBoardInvariants,
  createDemoBoard,
  filterCards,
  getBoardStats,
  getColumnWip,
  moveCard,
  moveCardRelative,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
} from "../app/board-model";

test("demo board starts with unique IDs and every card in one column", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));

  assertBoardInvariants(board);
  assert.equal(new Set(Object.keys(board.cards)).size, Object.keys(board.cards).length);
  assert.equal(
    board.columns.flatMap((column) => column.cardIds).length,
    Object.keys(board.cards).length,
  );
});

test("moves and reorders cards without duplicate order entries", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const moved = moveCard(board, "card-roadmap", "doing", 1);
  const reordered = moveCardRelative(moved, "card-roadmap", "down");

  assertBoardInvariants(reordered);
  assert.equal(
    reordered.columns.find((column) => column.id === "todo")?.cardIds.includes("card-roadmap"),
    false,
  );
  assert.deepEqual(
    reordered.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-analytics", "card-copy", "card-roadmap"],
  );
});

test("add and update preserve date-only due dates", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const added = addCard(board, "todo", {
    id: "card-new",
    title: "本地日期測試",
    dueDate: "2026-07-11",
  });
  const updated = updateCard(added, "card-new", {
    dueDate: "2026-07-12T00:00:00.000Z",
  });

  assertBoardInvariants(added);
  assert.equal(added.cards["card-new"].dueDate, "2026-07-11");
  assert.equal(updated.cards["card-new"].dueDate, "");
});

test("WIP warnings come from canonical unfiltered state", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const doing = board.columns.find((column) => column.id === "doing");

  assert.ok(doing);
  assert.deepEqual(getColumnWip(doing), { count: 2, limit: 3, reached: false });

  const moved = moveCard(board, "card-roadmap", "doing", 0);
  const canonicalDoing = moved.columns.find((column) => column.id === "doing");
  const filtered = filterCards(
    moved,
    { query: "不存在", labelId: "", priority: "all", due: "all" },
    "2026-07-10",
  );

  assert.equal(filtered.doing.length, 0);
  assert.ok(canonicalDoing);
  assert.deepEqual(getColumnWip(canonicalDoing), {
    count: 3,
    limit: 3,
    reached: true,
  });
});

test("serialized board reloads without changing card membership", () => {
  const board = addCard(createDemoBoard(new Date(2026, 6, 10)), "review", {
    id: "card-persisted",
    title: "重載後仍在同一欄",
  });
  const parsed = parsePersistedBoard(serializeBoard(board));

  assert.equal(parsed.error, null);
  assertBoardInvariants(parsed.board);
  assert.deepEqual(parsed.board.columns, board.columns);
  assert.deepEqual(Object.keys(parsed.board.cards).sort(), Object.keys(board.cards).sort());
});

test("malformed persisted state is recovered instead of crashing", () => {
  const parsed = parsePersistedBoard("{not-json");

  assert.equal(parsed.recovered, true);
  assert.match(parsed.error ?? "", /格式異常/);
  assertBoardInvariants(parsed.board);
});

test("normalization removes duplicate column order safely", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const malformed = {
    ...board,
    columns: board.columns.map((column) =>
      column.id === "todo"
        ? { ...column, cardIds: ["card-roadmap", "card-roadmap"] }
        : column,
    ),
  };
  const normalized = normalizeBoard(malformed);

  assertBoardInvariants(normalized);
  assert.equal(
    normalized.columns.flatMap((column) => column.cardIds).filter((id) => id === "card-roadmap")
      .length,
    1,
  );
});

test("overdue statistics use local YYYY-MM-DD comparisons", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const stats = getBoardStats(board, "2026-07-10");

  assert.equal(stats.overdue, 1);
  assert.equal(stats.completed, 1);
});
