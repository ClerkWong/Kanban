import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { describe, it } from "node:test";
import {
  addCard,
  assertBoardInvariants,
  createDemoBoard,
  filterCards,
  getMonthlyCompletionStats,
  getBoardStats,
  getColumnWip,
  moveCard,
  moveCardRelative,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
  type Card,
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

test("moving cards into and out of Done records the completion transition", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const completedAt = new Date("2026-07-10T09:30:00.000Z");
  const completed = moveCard(board, "card-roadmap", "done", 0, completedAt);

  assert.equal(completed.cards["card-roadmap"].completedAt, completedAt.toISOString());
  assert.equal(completed.cards["card-roadmap"].updatedAt, completedAt.toISOString());
  assert.equal(getBoardStats(completed, "2026-07-10").completed, 2);

  const edited = updateCard(completed, "card-roadmap", { title: "完成後補充說明" });
  assert.equal(edited.cards["card-roadmap"].completedAt, completedAt.toISOString());

  const reopenedAt = new Date("2026-07-11T09:30:00.000Z");
  const reopened = moveCard(edited, "card-roadmap", "todo", 0, reopenedAt);
  assert.equal(reopened.cards["card-roadmap"].completedAt, null);
  assert.equal(reopened.cards["card-roadmap"].updatedAt, reopenedAt.toISOString());

  const recompletedAt = new Date("2026-07-12T09:30:00.000Z");
  const recompleted = moveCard(reopened, "card-roadmap", "done", 0, recompletedAt);
  assert.equal(recompleted.cards["card-roadmap"].completedAt, recompletedAt.toISOString());
});

describe("getMonthlyCompletionStats", () => {
  function makeCard(id: string, completedAt: string | null, updatedAt = completedAt ?? "2026-01-01T00:00:00.000Z"): Card {
    return {
      id,
      title: `Card ${id}`,
      description: "",
      priority: "medium",
      labelIds: [],
      dueDate: "",
      checklist: [],
      members: [],
      attachments: [],
      createdAt: updatedAt,
      updatedAt,
      completedAt,
    };
  }

  it("returns the six most recent calendar months, including zero-completion months", () => {
    const board = createDemoBoard(new Date(2026, 6, 10));
    board.columns = board.columns.filter((c) => c.id !== "done");
    const stats = getMonthlyCompletionStats(board, 6, new Date(2026, 6, 10));

    assert.deepEqual(
      stats.map((stat) => [stat.month, stat.count]),
      [
        ["2026-02", 0],
        ["2026-03", 0],
        ["2026-04", 0],
        ["2026-05", 0],
        ["2026-06", 0],
        ["2026-07", 0],
      ],
    );
  });

  it("groups by completedAt and keeps the month stable after later edits", () => {
    const board = createDemoBoard(new Date(2026, 6, 10));
    const doneCol = board.columns.find((c) => c.id === "done")!;
    doneCol.cardIds = ["c1", "c2", "c3"];
    board.cards["c1"] = makeCard(
      "c1",
      "2026-05-15T10:00:00.000Z",
      "2026-07-20T10:00:00.000Z",
    );
    board.cards["c2"] = makeCard("c2", "2026-05-20T10:00:00.000Z");
    board.cards["c3"] = makeCard("c3", "2026-06-05T10:00:00.000Z");

    const stats = getMonthlyCompletionStats(board, 6, new Date(2026, 6, 10));

    assert.equal(stats.find((stat) => stat.month === "2026-05")?.count, 2);
    assert.equal(stats.find((stat) => stat.month === "2026-06")?.count, 1);
    assert.equal(stats.find((stat) => stat.month === "2026-07")?.count, 0);
    assert.equal(stats.find((stat) => stat.month === "2026-05")?.monthLabel, "2026 年 5 月");
  });

  it("uses local calendar dates and ignores invalid completion timestamps", () => {
    const board = createDemoBoard(new Date(2026, 6, 10));
    const doneCol = board.columns.find((c) => c.id === "done")!;
    doneCol.cardIds = ["c1", "c2"];
    board.cards["c1"] = makeCard("c1", "2026-06-15T10:00:00.000Z");
    board.cards["c2"] = makeCard("c2", "not-a-date");

    const stats = getMonthlyCompletionStats(board, 2, new Date(2026, 6, 10));

    assert.equal(stats.length, 2);
    assert.equal(stats[0].month, "2026-06");
    assert.equal(stats[1].month, "2026-07");
    assert.equal(stats[0].count, 1);
    assert.equal(stats[1].count, 0);
  });

  it("uses the local month at a UTC month boundary", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "-e",
        `
          import { createDemoBoard, getMonthlyCompletionStats } from "./app/board-model.ts";
          const board = createDemoBoard(new Date("2026-07-01T00:00:00.000Z"));
          board.cards["card-done"] = {
            ...board.cards["card-done"],
            completedAt: "2026-06-30T16:30:00.000Z",
          };
          process.stdout.write(JSON.stringify(getMonthlyCompletionStats(
            board,
            1,
            new Date("2026-07-01T00:00:00.000Z"),
          )));
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, TZ: "Asia/Taipei" },
      },
    );
    const stats = JSON.parse(output) as Array<{ month: string; count: number }>;

    assert.equal(stats[0]?.month, "2026-07");
    assert.equal(stats[0]?.count, 1);
  });
});
