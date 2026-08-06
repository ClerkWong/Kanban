import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_BOARD_SETTINGS,
  DONE_COLUMN_ID,
  MAX_BLOCKED_MS,
  addCard,
  createDemoBoard,
  moveCard,
  moveCardRelative,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
  type BoardState,
} from "../app/board-model";

test("schema v7 exposes flow fields with defaults", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 7);
  const board = createDemoBoard(new Date(2026, 7, 5));
  assert.deepEqual(board.settings, DEFAULT_BOARD_SETTINGS);
  for (const card of Object.values(board.cards)) {
    assert.equal(typeof card.columnEnteredAt, "string");
    assert.equal(card.blockedMs, 0);
    assert.equal(card.serviceClass, "standard");
  }
});

test("v6 data migrates without recomputing completedAt", () => {
  const legacy = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 7, 5)))) as BoardState;
  // 模擬 v6：拿掉 v7 欄位並降版
  const v6 = {
    ...legacy,
    version: 6,
    settings: undefined,
    cards: Object.fromEntries(
      Object.entries(legacy.cards).map(([id, card]) => {
        const { columnEnteredAt, startedAt, blockedMs, serviceClass, ...rest } = card;
        void columnEnteredAt; void startedAt; void blockedMs; void serviceClass;
        return [id, rest];
      }),
    ),
  };
  const { board, recovered } = parsePersistedBoard(JSON.stringify(v6));
  assert.equal(recovered, false);
  assert.equal(board.version, 7);
  assert.deepEqual(board.settings, DEFAULT_BOARD_SETTINGS);
  const done = board.cards["card-done"];
  assert.equal(done.completedAt, legacy.cards["card-done"].completedAt);
  assert.equal(done.startedAt, null);
  assert.equal(done.blockedMs, 0);
  assert.equal(done.serviceClass, "standard");
  assert.equal(done.columnEnteredAt, done.updatedAt);
});

test("normalize clamps invalid flow values", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const raw = JSON.parse(serializeBoard(board)) as BoardState;
  const cardId = Object.keys(raw.cards)[0];
  (raw.cards[cardId] as unknown as Record<string, unknown>).blockedMs = MAX_BLOCKED_MS * 2;
  (raw.cards[cardId] as unknown as Record<string, unknown>).serviceClass = "vip";
  (raw.cards[cardId] as unknown as Record<string, unknown>).columnEnteredAt = "not-a-date";
  (raw as unknown as Record<string, unknown>).settings = {
    agingWarnDays: 400, agingAlertDays: 0, expediteWipLimit: 1000,
  };
  const normalized = normalizeBoard(raw);
  assert.equal(normalized.cards[cardId].blockedMs, MAX_BLOCKED_MS);
  assert.equal(normalized.cards[cardId].serviceClass, "standard");
  assert.equal(normalized.cards[cardId].columnEnteredAt, normalized.cards[cardId].updatedAt);
  assert.equal(normalized.settings.agingWarnDays, 365);
  assert.equal(normalized.settings.agingAlertDays, 365);
  assert.equal(normalized.settings.expediteWipLimit, 99);
});

test("cross-column move updates columnEnteredAt; same-column reorder does not", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const before = board.cards["card-analytics"].columnEnteredAt; // 位於 doing
  const moveTime = new Date("2026-08-05T10:00:00.000Z");
  const moved = moveCard(board, "card-analytics", "review", 0, moveTime);
  assert.equal(moved.cards["card-analytics"].columnEnteredAt, moveTime.toISOString());
  assert.equal(moved.cards["card-analytics"].updatedAt, moveTime.toISOString());

  const reordered = moveCardRelative(moved, "card-review", "down");
  assert.equal(reordered.cards["card-review"].columnEnteredAt, board.cards["card-review"].columnEnteredAt);
  void before;
});

test("startedAt is set once when leaving the first column", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  assert.equal(board.cards["card-roadmap"].startedAt, null); // 位於 todo
  const startTime = new Date("2026-08-05T09:00:00.000Z");
  const started = moveCard(board, "card-roadmap", "doing", 0, startTime);
  assert.equal(started.cards["card-roadmap"].startedAt, startTime.toISOString());

  const back = moveCard(started, "card-roadmap", "todo", 0, new Date("2026-08-05T11:00:00.000Z"));
  assert.equal(back.cards["card-roadmap"].startedAt, startTime.toISOString());
  const again = moveCard(back, "card-roadmap", "doing", 0, new Date("2026-08-05T12:00:00.000Z"));
  assert.equal(again.cards["card-roadmap"].startedAt, startTime.toISOString());
});

test("addCard in a non-first column sets startedAt at creation", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const inDoing = addCard(board, "doing", { title: "直接開工" }, new Date("2026-08-05T08:00:00.000Z"));
  const created = Object.values(inDoing.cards).find((card) => card.title === "直接開工");
  assert.ok(created);
  assert.equal(created.startedAt, "2026-08-05T08:00:00.000Z");
  assert.equal(created.columnEnteredAt, "2026-08-05T08:00:00.000Z");

  const inTodo = addCard(board, "todo", { title: "先排隊" }, new Date("2026-08-05T08:00:00.000Z"));
  const queued = Object.values(inTodo.cards).find((card) => card.title === "先排隊");
  assert.ok(queued);
  assert.equal(queued.startedAt, null);
});

test("unblocking accumulates blockedMs across cycles", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-roadmap", { blocked: true, blockedReason: "等待回覆" },
    new Date("2026-08-05T09:00:00.000Z"));
  board = updateCard(board, "card-roadmap", { blocked: false },
    new Date("2026-08-05T10:00:00.000Z"));
  assert.equal(board.cards["card-roadmap"].blockedMs, 3600_000);

  board = updateCard(board, "card-roadmap", { blocked: true, blockedReason: "又卡住" },
    new Date("2026-08-05T11:00:00.000Z"));
  board = updateCard(board, "card-roadmap", { blocked: false },
    new Date("2026-08-05T11:30:00.000Z"));
  assert.equal(board.cards["card-roadmap"].blockedMs, 3600_000 + 1800_000);
});

test("expedite cards stay at the front of each column", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  // doing 欄目前為 ["card-analytics", "card-copy"]
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  assert.deepEqual(
    board.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-copy", "card-analytics"],
  );

  // 拖放企圖把非加急卡放到加急卡前面：normalizeBoard 拉回
  const dragged = moveCard(board, "card-analytics", "doing", 0);
  assert.deepEqual(
    dragged.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-copy", "card-analytics"],
  );

  // 解除加急：回到非加急區段最前
  const cleared = updateCard(board, "card-copy", { serviceClass: "standard" });
  assert.deepEqual(
    cleared.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-copy", "card-analytics"],
  );
});

test("becoming expedite lands at the end of the expedite segment", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-analytics", { serviceClass: "expedite" }); // doing: [analytics, copy]
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  assert.deepEqual(
    board.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-analytics", "card-copy"],
  );
});

test("orphaned expedite card rejoins the front of the first column", () => {
  const board = updateCard(createDemoBoard(new Date(2026, 7, 5)), "card-copy", {
    serviceClass: "expedite",
  });
  // 模擬孤兒卡：從所有欄位的 cardIds 移除，但卡片本身仍存在於 cards 中。
  const withOrphan: BoardState = {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cardIds: column.cardIds.filter((id) => id !== "card-copy"),
    })),
  };
  const normalized = normalizeBoard(withOrphan);
  assert.deepEqual(
    normalized.columns.find((column) => column.id === "todo")?.cardIds,
    ["card-copy", "card-roadmap", "card-onboarding"],
  );

  // normalizeBoard 必須冪等：再次 normalize 不應改變順序。
  assert.deepEqual(normalizeBoard(normalized), normalized);
});

test("done column also enforces expedite-first order", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-review", { serviceClass: "expedite" });
  board = moveCard(board, "card-review", DONE_COLUMN_ID, 1); // 附加在 card-done 之後
  assert.deepEqual(
    board.columns.find((column) => column.id === DONE_COLUMN_ID)?.cardIds,
    ["card-review", "card-done"],
  );
});
