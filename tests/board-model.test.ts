import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { describe, it } from "node:test";
import {
  COLUMN_TITLE_MAX_LENGTH,
  DONE_COLUMN_ID,
  MAX_BOARD_COLUMNS,
  addCard,
  addColumn,
  assertBoardInvariants,
  createDemoBoard,
  deleteColumn,
  filterCards,
  getMonthlyCompletionStats,
  getBoardStats,
  getColumnWip,
  moveCard,
  moveCardRelative,
  moveColumnRelative,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
  updateColumnTitle,
  validateColumnDeletion,
  validateColumnTitle,
  validateNewColumnTitle,
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
    {
      query: "不存在",
      labelId: "",
      priority: "all",
      due: "all",
      assigneeUserId: "",
      blocked: "all",
      serviceClass: "all",
    },
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

test("column titles can change without changing workflow identity or completion state", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const doneBefore = board.columns.find((column) => column.id === "done");
  const completedAt = board.cards["card-done"].completedAt;
  const renamedAt = new Date("2026-08-05T02:00:00.000Z");

  const renamed = updateColumnTitle(board, "done", "  已上線  ", renamedAt);
  const doneAfter = renamed.columns.find((column) => column.id === "done");

  assert.ok(doneBefore);
  assert.ok(doneAfter);
  assert.equal(doneAfter.title, "已上線");
  assert.equal(doneAfter.id, doneBefore.id);
  assert.equal(doneAfter.wipLimit, null);
  assert.deepEqual(doneAfter.cardIds, doneBefore.cardIds);
  assert.equal(renamed.cards["card-done"].completedAt, completedAt);
  assert.equal(renamed.lastSavedAt, renamedAt.toISOString());
});

test("column title validation rejects blank, oversized, duplicate, and missing targets", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));

  assert.equal(validateColumnTitle(board, "todo", "   "), "empty");
  assert.equal(
    validateColumnTitle(board, "todo", "欄".repeat(COLUMN_TITLE_MAX_LENGTH + 1)),
    "too_long",
  );
  assert.equal(validateColumnTitle(board, "todo", "完成"), "duplicate");
  assert.equal(validateColumnTitle(board, "missing", "待處理"), "missing");
  assert.equal(updateColumnTitle(board, "todo", "完成"), board);
});

test("owners can add and reorder workflow columns without changing completion identity", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const createdAt = new Date("2026-08-05T03:00:00.000Z");
  const added = addColumn(board, { title: "  驗收  ", wipLimit: 4 }, createdAt);
  const addedColumn = added.columns.find((column) => column.title === "驗收");

  assert.ok(addedColumn);
  assert.match(addedColumn.id, /^column-/);
  assert.equal(addedColumn.wipLimit, 4);
  assert.deepEqual(addedColumn.cardIds, []);
  assert.equal(
    added.columns.findIndex((column) => column.id === DONE_COLUMN_ID),
    added.columns.length - 1,
  );
  assert.equal(added.lastSavedAt, createdAt.toISOString());

  const moved = moveColumnRelative(added, addedColumn.id, "left");
  assert.equal(
    moved.columns.findIndex((column) => column.id === addedColumn.id),
    added.columns.findIndex((column) => column.id === addedColumn.id) - 1,
  );
  assert.equal(moved.columns.find((column) => column.id === DONE_COLUMN_ID)?.id, DONE_COLUMN_ID);
  assert.equal(moved.cards["card-done"].completedAt, board.cards["card-done"].completedAt);
  assertBoardInvariants(moved);
});

test("new workflow columns enforce names and the board column limit", () => {
  let board = createDemoBoard(new Date(2026, 6, 10));

  assert.equal(validateNewColumnTitle(board, "   "), "empty");
  assert.equal(validateNewColumnTitle(board, "完成"), "duplicate");
  assert.equal(
    validateNewColumnTitle(board, "欄".repeat(COLUMN_TITLE_MAX_LENGTH + 1)),
    "too_long",
  );

  while (board.columns.length < MAX_BOARD_COLUMNS) {
    board = addColumn(board, { title: `新增欄位 ${board.columns.length}` });
  }
  assert.equal(validateNewColumnTitle(board, "超出上限"), "max_columns");
  assert.equal(addColumn(board, { title: "超出上限" }), board);
});

test("only empty non-completion columns can be deleted", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const added = addColumn(board, { title: "暫存" });
  const emptyColumn = added.columns.find((column) => column.title === "暫存");
  assert.ok(emptyColumn);

  assert.equal(validateColumnDeletion(added, "todo"), "not_empty");
  assert.equal(validateColumnDeletion(added, DONE_COLUMN_ID), "done");
  assert.equal(validateColumnDeletion(added, "missing"), "missing");
  assert.equal(deleteColumn(added, "todo"), added);

  const deleted = deleteColumn(added, emptyColumn.id);
  assert.equal(deleted.columns.some((column) => column.id === emptyColumn.id), false);
  assertBoardInvariants(deleted);

  const minimal = {
    ...deleted,
    columns: deleted.columns.filter((column) => column.id === "todo" || column.id === DONE_COLUMN_ID),
  };
  assert.equal(validateColumnDeletion(minimal, "todo"), "not_empty");
  const emptyMinimal = {
    ...minimal,
    cards: {},
    columns: minimal.columns.map((column) => ({ ...column, cardIds: [] })),
  };
  assert.equal(validateColumnDeletion(emptyMinimal, "todo"), "minimum_columns");
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

test("multiple canonical Project assignees are deduplicated and survive reload", () => {
  const board = addCard(createDemoBoard(new Date(2026, 6, 10)), "todo", {
    id: "card-assigned",
    title: "多人共同任務",
    assigneeUserIds: ["user-a", "user-b", "user-a"],
  });
  const updated = updateCard(board, "card-assigned", {
    assigneeUserIds: ["user-b", "user-c", "user-b"],
  });
  const parsed = parsePersistedBoard(serializeBoard(updated));

  assert.deepEqual(board.cards["card-assigned"].assigneeUserIds, ["user-a", "user-b"]);
  assert.deepEqual(parsed.board.cards["card-assigned"].assigneeUserIds, ["user-b", "user-c"]);
});

test("assignee and blocked filters compose without changing canonical order", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const assigned = updateCard(board, "card-roadmap", {
    assigneeUserIds: ["user-a", "user-b"],
    blocked: true,
    blockedReason: "等待 API 權限",
  }, new Date("2026-07-10T09:00:00.000Z"));
  const filtered = filterCards(assigned, {
    query: "",
    labelId: "",
    priority: "all",
    due: "all",
    assigneeUserId: "user-b",
    blocked: "blocked",
    serviceClass: "all",
  }, "2026-07-10");

  assert.deepEqual(filtered.todo.map((card) => card.id), ["card-roadmap"]);
  assert.deepEqual(
    assigned.columns.find((column) => column.id === "todo")?.cardIds,
    board.columns.find((column) => column.id === "todo")?.cardIds,
  );
});

test("blocked transition records its first timestamp and clearing removes blocker details", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const blocked = updateCard(board, "card-roadmap", {
    blocked: true,
    blockedReason: " 等待客戶回覆 ",
  }, new Date("2026-07-10T09:00:00.000Z"));
  const reasonEdited = updateCard(blocked, "card-roadmap", {
    blockedReason: "等待客戶與法務確認",
  }, new Date("2026-07-11T09:00:00.000Z"));
  const cleared = updateCard(reasonEdited, "card-roadmap", {
    blocked: false,
  }, new Date("2026-07-12T09:00:00.000Z"));

  assert.equal(blocked.cards["card-roadmap"].blockedReason, "等待客戶回覆");
  assert.equal(blocked.cards["card-roadmap"].blockedAt, "2026-07-10T09:00:00.000Z");
  assert.equal(reasonEdited.cards["card-roadmap"].blockedAt, "2026-07-10T09:00:00.000Z");
  assert.equal(cleared.cards["card-roadmap"].blocked, false);
  assert.equal(cleared.cards["card-roadmap"].blockedReason, "");
  assert.equal(cleared.cards["card-roadmap"].blockedAt, null);
});

test("v4 boards gain an empty assignee list without rewriting completion history", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const completed = board.cards["card-done"];
  completed.completedAt = "2026-06-15T10:00:00.000Z";
  completed.updatedAt = "2026-07-20T10:00:00.000Z";
  const legacy = JSON.stringify({
    ...board,
    version: 4,
    cards: Object.fromEntries(
      Object.entries(board.cards).map(([id, card]) => {
        const withoutAssignees = { ...card } as Partial<Card>;
        delete withoutAssignees.assigneeUserIds;
        return [id, withoutAssignees];
      }),
    ),
  });

  const parsed = parsePersistedBoard(legacy);

  assert.equal(parsed.board.version, 8);
  assert.deepEqual(parsed.board.cards["card-done"].assigneeUserIds, []);
  assert.equal(
    parsed.board.cards["card-done"].completedAt,
    "2026-06-15T10:00:00.000Z",
  );
});

test("v5 boards gain clear blocker fields and migrate to schema v6", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const legacy = JSON.parse(serializeBoard(board));
  legacy.version = 5;
  for (const card of Object.values(legacy.cards) as Array<Record<string, unknown>>) {
    delete card.blocked;
    delete card.blockedReason;
    delete card.blockedAt;
  }

  const parsed = parsePersistedBoard(JSON.stringify(legacy));

  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 8);
  for (const card of Object.values(parsed.board.cards)) {
    assert.equal(card.blocked, false);
    assert.equal(card.blockedReason, "");
    assert.equal(card.blockedAt, null);
  }
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
      assigneeUserIds: [],
      blocked: false,
      blockedReason: "",
      blockedAt: null,
      members: [],
      attachments: [],
      createdAt: updatedAt,
      updatedAt,
      completedAt,
      columnEnteredAt: updatedAt,
      startedAt: null,
      blockedMs: 0,
      serviceClass: "standard",
      assignmentWindows: [],
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
