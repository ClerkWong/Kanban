import assert from "node:assert/strict";
import test from "node:test";
import {
  barSpanInWindow,
  dayRange,
  groupBarsByUser,
  overloadedDays,
  packLanes,
  rangeFrom,
  shiftRange,
} from "../app/projects/resource-model";
import type { ResourceBar } from "../app/projects/types";

const ALICE = "11111111-2222-4333-8444-555555555555";
const BOB = "22222222-3333-4444-8555-666666666666";

test("dayRange lists every day inclusive of both ends", () => {
  assert.deepEqual(dayRange("2026-08-07", "2026-08-09"),
    ["2026-08-07", "2026-08-08", "2026-08-09"]);
  assert.deepEqual(dayRange("2026-08-07", "2026-08-07"), ["2026-08-07"]);
});

test("dayRange crosses month and year boundaries", () => {
  assert.deepEqual(dayRange("2026-08-31", "2026-09-02"),
    ["2026-08-31", "2026-09-01", "2026-09-02"]);
  assert.deepEqual(dayRange("2026-12-31", "2027-01-01"),
    ["2026-12-31", "2027-01-01"]);
});

test("dayRange spans a leap day", () => {
  assert.deepEqual(dayRange("2028-02-28", "2028-03-01"),
    ["2028-02-28", "2028-02-29", "2028-03-01"]);
});

test("shiftRange moves both ends and keeps the length", () => {
  assert.deepEqual(shiftRange("2026-08-07", "2026-08-20", 14),
    { from: "2026-08-21", to: "2026-09-03" });
  assert.deepEqual(shiftRange("2026-08-07", "2026-08-20", -14),
    { from: "2026-07-24", to: "2026-08-06" });
});

test("rangeFrom covers 14 days inclusive of both ends", () => {
  assert.deepEqual(rangeFrom("2026-08-07"),
    { from: "2026-08-07", to: "2026-08-20" });
  assert.equal(dayRange(...Object.values(rangeFrom("2026-08-07")) as [string, string]).length, 14);
});

test("rangeFrom crosses a month boundary", () => {
  assert.deepEqual(rangeFrom("2026-08-25"),
    { from: "2026-08-25", to: "2026-09-07" });
});

test("barSpanInWindow clips a bar that straddles the window", () => {
  const days = dayRange("2026-08-07", "2026-08-17");
  assert.deepEqual(
    barSpanInWindow({ startDate: "2026-08-05", endDate: "2026-08-09" }, days),
    { startIndex: 0, span: 3 },
  );
  assert.deepEqual(
    barSpanInWindow({ startDate: "2026-08-15", endDate: "2026-08-25" }, days),
    { startIndex: 8, span: 3 },
  );
  assert.deepEqual(
    barSpanInWindow({ startDate: "2026-08-07", endDate: "2026-08-07" }, days),
    { startIndex: 0, span: 1 },
  );
  assert.equal(
    barSpanInWindow({ startDate: "2026-07-01", endDate: "2026-07-05" }, days),
    null,
  );
  assert.deepEqual(
    barSpanInWindow({ startDate: "2026-08-01", endDate: "2026-08-31" }, days),
    { startIndex: 0, span: 11 },
  );
});

// bar 工廠：只填排版用得到的欄位，其餘以 ResourceBar 的合法值補齊
function bar(cardId: string, startDate: string, endDate: string, userId = ALICE): ResourceBar {
  return {
    userId, cardId, title: cardId,
    startDate, endDate,
    projectId: "p1", projectName: "P", boardId: "b1", boardName: "B",
    blocked: false, serviceClass: "standard",
  };
}

test("packLanes puts non-overlapping bars on the same lane", () => {
  const result = packLanes([
    bar("a", "2026-08-07", "2026-08-08"),
    bar("b", "2026-08-10", "2026-08-11"),
  ]);
  assert.deepEqual(result.map((entry) => [entry.bar.cardId, entry.lane]),
    [["a", 0], ["b", 0]]);
});

test("packLanes pushes overlapping bars onto separate lanes", () => {
  const result = packLanes([
    bar("a", "2026-08-07", "2026-08-13"),
    bar("b", "2026-08-12", "2026-08-17"),
  ]);
  assert.deepEqual(result.map((entry) => [entry.bar.cardId, entry.lane]),
    [["a", 0], ["b", 1]]);
});

test("packLanes reuses a lane once it is free", () => {
  const result = packLanes([
    bar("a", "2026-08-07", "2026-08-08"),
    bar("b", "2026-08-07", "2026-08-13"),
    bar("c", "2026-08-10", "2026-08-11"),
  ]);
  const lanes = new Map(result.map((entry) => [entry.bar.cardId, entry.lane]));
  assert.equal(lanes.get("a"), 0);
  assert.equal(lanes.get("b"), 1);
  assert.equal(lanes.get("c"), 0);
});

test("packLanes treats adjacent bars as non-overlapping", () => {
  const result = packLanes([
    bar("a", "2026-08-07", "2026-08-08"),
    bar("b", "2026-08-09", "2026-08-10"),
  ]);
  assert.deepEqual(result.map((entry) => entry.lane), [0, 0]);
});

test("packLanes is deterministic regardless of input order", () => {
  const first = packLanes([
    bar("a", "2026-08-07", "2026-08-13"),
    bar("b", "2026-08-07", "2026-08-13"),
  ]);
  const second = packLanes([
    bar("b", "2026-08-07", "2026-08-13"),
    bar("a", "2026-08-07", "2026-08-13"),
  ]);
  assert.deepEqual(
    first.map((entry) => [entry.bar.cardId, entry.lane]),
    second.map((entry) => [entry.bar.cardId, entry.lane]),
  );
  assert.deepEqual(first.map((entry) => entry.lane), [0, 1]);
});

test("overloadedDays reports only days with two or more concurrent bars", () => {
  const days = dayRange("2026-08-07", "2026-08-17");
  const result = overloadedDays([
    bar("a", "2026-08-07", "2026-08-13"),
    bar("b", "2026-08-12", "2026-08-17"),
  ], days);
  assert.deepEqual([...result.entries()].sort(),
    [["2026-08-12", 2], ["2026-08-13", 2]]);
});

test("overloadedDays ignores overlap that falls outside the window", () => {
  const days = dayRange("2026-08-14", "2026-08-17");
  const result = overloadedDays([
    bar("a", "2026-08-07", "2026-08-13"),
    bar("b", "2026-08-07", "2026-08-13"),
  ], days);
  assert.equal(result.size, 0);
});

test("overloadedDays counts three concurrent bars", () => {
  const days = dayRange("2026-08-07", "2026-08-08");
  const result = overloadedDays([
    bar("a", "2026-08-07", "2026-08-07"),
    bar("b", "2026-08-07", "2026-08-07"),
    bar("c", "2026-08-07", "2026-08-07"),
  ], days);
  assert.deepEqual([...result.entries()], [["2026-08-07", 3]]);
});

test("groupBarsByUser keeps input order within each user", () => {
  const result = groupBarsByUser([
    bar("a", "2026-08-07", "2026-08-08", ALICE),
    bar("b", "2026-08-07", "2026-08-08", BOB),
    bar("c", "2026-08-09", "2026-08-10", ALICE),
  ]);
  assert.deepEqual(result.get(ALICE)?.map((entry) => entry.cardId), ["a", "c"]);
  assert.deepEqual(result.get(BOB)?.map((entry) => entry.cardId), ["b"]);
});
