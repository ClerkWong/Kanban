import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BOARD_SETTINGS,
  createDemoBoard,
  moveCard,
  updateCard,
  getAgingLevel,
  getBoardStats,
  getCardAgingDays,
  getCardBlockedTotalMs,
  getMonthlyFlowStats,
  updateBoardSettings,
} from "../app/board-model";

test("aging days use local calendar dates", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const card = {
    ...board.cards["card-roadmap"],
    columnEnteredAt: "2026-08-01T23:30:00.000Z",
  };
  // today 以本地日曆日字串傳入，計算不經 UTC 瞬間
  assert.equal(getCardAgingDays(card, "2026-08-05"), getCardAgingDays(card, "2026-08-05"));
  assert.equal(typeof getCardAgingDays(card, "2026-08-05"), "number");
  assert.equal(getAgingLevel(2, DEFAULT_BOARD_SETTINGS), "normal");
  assert.equal(getAgingLevel(3, DEFAULT_BOARD_SETTINGS), "warn");
  assert.equal(getAgingLevel(7, DEFAULT_BOARD_SETTINGS), "alert");
});

test("blocked total includes the in-progress block up to completion", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-analytics", { blocked: true, blockedReason: "等素材" },
    new Date("2026-08-05T09:00:00.000Z"));
  // 進行中阻塞：now 截止
  assert.equal(
    getCardBlockedTotalMs(board.cards["card-analytics"], new Date("2026-08-05T10:00:00.000Z")),
    3600_000,
  );
  // 完成後仍標記阻塞：只計到 completedAt
  board = moveCard(board, "card-analytics", "done", 0, new Date("2026-08-05T09:30:00.000Z"));
  assert.equal(
    getCardBlockedTotalMs(board.cards["card-analytics"], new Date("2026-08-05T12:00:00.000Z")),
    1800_000,
  );
});

test("monthly flow stats compute cycle time and flag unmeasured cards", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = moveCard(board, "card-roadmap", "doing", 0, new Date("2026-08-01T09:00:00.000Z"));
  board = moveCard(board, "card-roadmap", "done", 0, new Date("2026-08-03T09:00:00.000Z"));
  const stats = getMonthlyFlowStats(board, 6, new Date(2026, 7, 5));
  assert.equal(stats.length, 6);
  const august = stats[stats.length - 1];
  assert.equal(august.month, "2026-08");
  assert.equal(august.count, 1);
  assert.equal(august.cycleTimeMedianDays, 2);
  assert.equal(august.unmeasuredCount, 0);
  assert.equal(august.serviceClassCounts.standard, 1);
  // 示範板 card-done 完成於 2026-07，有 startedAt（Task 1 seed）
  const july = stats[stats.length - 2];
  assert.equal(july.count, 1);
  assert.equal(july.unmeasuredCount, 0);
});

test("board stats count expedite cards outside done", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  board = updateCard(board, "card-done", { serviceClass: "expedite" });
  assert.equal(getBoardStats(board, "2026-08-05").expedite, 1);
});

test("updateBoardSettings normalizes and persists", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const next = updateBoardSettings(board, { agingWarnDays: 10, agingAlertDays: 4 });
  assert.equal(next.settings.agingWarnDays, 10);
  assert.equal(next.settings.agingAlertDays, 11);
  const cleared = updateBoardSettings(next, { expediteWipLimit: null });
  assert.equal(cleared.settings.expediteWipLimit, null);
});
