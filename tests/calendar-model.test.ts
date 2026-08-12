import assert from "node:assert/strict";
import test from "node:test";
import {
  assigneeLoad,
  currentMonth,
  groupCardsByDueDate,
  todayString,
  isOverdue,
  monthGrid,
  monthLabel,
  shiftMonth,
} from "../app/projects/calendar-model";
import type { CalendarCard } from "../app/projects/types";

function card(overrides: Partial<CalendarCard> & Pick<CalendarCard, "cardId">): CalendarCard {
  return {
    cardId: overrides.cardId,
    title: overrides.title ?? "任務",
    dueDate: overrides.dueDate ?? "",
    assigneeUserIds: overrides.assigneeUserIds ?? [],
    projectId: overrides.projectId ?? "p1",
    projectName: overrides.projectName ?? "專案",
    boardId: overrides.boardId ?? "b1",
    boardName: overrides.boardName ?? "看板",
    blocked: overrides.blocked ?? false,
    serviceClass: overrides.serviceClass ?? "standard",
  };
}

test("monthGrid 以週日起始並補滿完整週", () => {
  // 2026-08-01 是週六 → 前面補 6 格（週日到週五屬於 7 月）
  const grid = monthGrid("2026-08");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].date, "2026-07-26");
  assert.equal(grid[0].inMonth, false);
  const inMonth = grid.filter((cell) => cell.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[0].date, "2026-08-01");
  assert.equal(inMonth[30].date, "2026-08-31");
  assert.equal(grid[grid.length - 1].date, "2026-09-05");
  assert.equal(grid[grid.length - 1].inMonth, false);
});

test("monthGrid 處理閏年二月", () => {
  const grid = monthGrid("2028-02");
  assert.equal(grid.filter((cell) => cell.inMonth).length, 29);
});

test("monthGrid 恰好整週的月份不需補前後格", () => {
  // 2026-02-01 是週日、2026 非閏年（28 天恰為 4 週）→ 首尾格都不需補格
  const grid = monthGrid("2026-02");
  assert.equal(grid.length, 28);
  assert.equal(grid[0].date, "2026-02-01");
  assert.equal(grid[0].inMonth, true);
  assert.equal(grid[grid.length - 1].date, "2026-02-28");
  assert.equal(grid[grid.length - 1].inMonth, true);
  assert.equal(grid.filter((cell) => cell.inMonth).length, 28);
});

test("shiftMonth 跨年前後移動", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-08", 0), "2026-08");
});

test("shiftMonth 位移量超過 12 個月時仍正確跨年", () => {
  assert.equal(shiftMonth("2026-08", -20), "2024-12");
});

test("monthLabel 使用繁中格式", () => {
  assert.equal(monthLabel("2026-08"), "2026 年 8 月");
});

test("currentMonth 依本地日期回傳 YYYY-MM", () => {
  assert.equal(currentMonth(new Date(2026, 7, 12)), "2026-08");
});

test("todayString 回傳本地日期字串", () => {
  assert.equal(todayString(new Date(2026, 7, 3)), "2026-08-03");
});

test("groupCardsByDueDate 依日期分組且略過未排程卡", () => {
  const grouped = groupCardsByDueDate([
    card({ cardId: "a", dueDate: "2026-08-14" }),
    card({ cardId: "b", dueDate: "2026-08-14" }),
    card({ cardId: "c", dueDate: "" }),
  ]);
  assert.deepEqual(grouped["2026-08-14"].map((entry) => entry.cardId), ["a", "b"]);
  assert.equal(Object.keys(grouped).length, 1);
});

test("assigneeLoad 統計每人件數與未指派卡數", () => {
  const load = assigneeLoad(
    [
      card({ cardId: "a", assigneeUserIds: ["u1"] }),
      card({ cardId: "b", assigneeUserIds: ["u1", "u2"] }),
      card({ cardId: "c", assigneeUserIds: [] }),
    ],
    [
      { userId: "u1", displayName: "阿明" },
      { userId: "u2", displayName: "小華" },
    ],
  );
  assert.deepEqual(load.entries, [
    { userId: "u1", displayName: "阿明", count: 2 },
    { userId: "u2", displayName: "小華", count: 1 },
  ]);
  assert.equal(load.unassignedCount, 1);
});

test("assigneeLoad 件數相同時依 zh-Hant 顯示名稱排序", () => {
  // 卡片刻意先出現 u1（阿明）再出現 u2（小華），若排序退化成 Map 插入順序
  // 就會得到 [u1, u2]；zh-Hant collation 下「小華」排在「阿明」之前，
  // 因此正確結果應該是 [u2, u1]。
  const load = assigneeLoad(
    [
      card({ cardId: "a", assigneeUserIds: ["u1"] }),
      card({ cardId: "b", assigneeUserIds: ["u2"] }),
    ],
    [
      { userId: "u1", displayName: "阿明" },
      { userId: "u2", displayName: "小華" },
    ],
  );
  assert.deepEqual(load.entries, [
    { userId: "u2", displayName: "小華", count: 1 },
    { userId: "u1", displayName: "阿明", count: 1 },
  ]);
});

test("assigneeLoad 對目錄查不到的 userId 以短 ID 呈現", () => {
  const load = assigneeLoad([card({ cardId: "a", assigneeUserIds: ["deadbeef-1111"] })], []);
  assert.equal(load.entries.length, 1);
  assert.equal(load.entries[0].displayName, "deadbeef");
});

test("isOverdue 只在截止日早於今天時為真", () => {
  assert.equal(isOverdue("2026-08-11", "2026-08-12"), true);
  assert.equal(isOverdue("2026-08-12", "2026-08-12"), false);
  assert.equal(isOverdue("2026-08-20", "2026-08-12"), false);
  assert.equal(isOverdue("", "2026-08-12"), false);
});
