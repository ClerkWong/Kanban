import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PX_PER_DAY,
  TIMELINE_CARD_WIDTH,
  ZOOM_LEVELS,
  buildForest,
  dayOffset,
  layoutTimeline,
  startedDay,
  timelineBounds,
  unstartedCards,
} from "../app/projects/timeline-model";
import type { Card } from "../app/board-model";

function card(id: string, startedAt: string | null, parentCardId: string | null = null): Card {
  return {
    id, title: id, description: "", priority: "medium", labelIds: [], dueDate: "",
    checklist: [], assigneeUserIds: [], assignmentWindows: [], parentCardId,
    blocked: false, blockedReason: "", blockedAt: null, members: [], attachments: [],
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null, columnEnteredAt: "2026-08-01T00:00:00.000Z",
    startedAt, blockedMs: 0, serviceClass: "standard",
  };
}

test("zoom levels include the default", () => {
  assert.equal(ZOOM_LEVELS.includes(DEFAULT_PX_PER_DAY), true);
});

test("startedDay uses the viewer's local calendar day", () => {
  // 這個斷言在任何時區都成立：取出的日期必為 UTC 日或其相鄰日
  const day = startedDay("2026-08-17T12:00:00.000Z");
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(["2026-08-16", "2026-08-17", "2026-08-18"].includes(day), true);
});

test("dayOffset counts whole days and crosses month, year and leap boundaries", () => {
  assert.equal(dayOffset("2026-08-17", "2026-08-17"), 0);
  assert.equal(dayOffset("2026-08-17", "2026-08-20"), 3);
  assert.equal(dayOffset("2026-08-31", "2026-09-01"), 1);
  assert.equal(dayOffset("2026-12-31", "2027-01-01"), 1);
  assert.equal(dayOffset("2028-02-28", "2028-03-01"), 2);
  assert.equal(dayOffset("2027-02-28", "2027-03-01"), 1);
  assert.equal(dayOffset("2026-08-20", "2026-08-17"), -3);
});

test("timelineBounds spans the earliest start to today", () => {
  const cards = [
    card("a", "2026-08-05T00:00:00.000Z"),
    card("b", "2026-08-09T00:00:00.000Z"),
    card("c", null),
  ];
  const bounds = timelineBounds(cards, "2026-08-17");
  assert.equal(bounds?.from, startedDay("2026-08-05T00:00:00.000Z"));
  assert.equal(bounds?.to, "2026-08-17");
});

test("timelineBounds extends past today when a start is in the future", () => {
  const cards = [card("a", "2026-09-30T00:00:00.000Z")];
  const bounds = timelineBounds(cards, "2026-08-17");
  assert.equal(bounds?.to, startedDay("2026-09-30T00:00:00.000Z"));
});

test("timelineBounds returns null when nothing has started", () => {
  assert.equal(timelineBounds([card("a", null), card("b", null)], "2026-08-17"), null);
  assert.equal(timelineBounds([], "2026-08-17"), null);
});

test("buildForest lists roots and children", () => {
  const cards = [card("a", null), card("b", null, "a"), card("c", null, "b"), card("x", null)];
  const forest = buildForest(cards);
  assert.deepEqual(forest.roots.sort(), ["a", "x"]);
  assert.deepEqual(forest.childrenOf.get("a"), ["b"]);
  assert.deepEqual(forest.childrenOf.get("b"), ["c"]);
  assert.equal(forest.childrenOf.get("c"), undefined);
});

test("buildForest tolerates a cycle without recursing forever", () => {
  const cards = [card("a", null, "b"), card("b", null, "a")];
  const forest = buildForest(cards);
  // 環中的卡片一張都不會消失：不是 root 就是某人的 child
  const reachable = new Set(forest.roots);
  for (const children of forest.childrenOf.values()) {
    for (const id of children) reachable.add(id);
  }
  assert.deepEqual([...reachable].sort(), ["a", "b"]);
});

test("unstartedCards keeps only unstarted cards, ordered by createdAt then id", () => {
  const late = { ...card("z", null), createdAt: "2026-08-09T00:00:00.000Z" };
  const early = { ...card("a", null), createdAt: "2026-08-01T00:00:00.000Z" };
  const started = card("s", "2026-08-05T00:00:00.000Z");
  assert.deepEqual(
    unstartedCards([late, started, early]).map((entry) => entry.id),
    ["a", "z"],
  );
});

test("layoutTimeline positions cards by day offset times pxPerDay", () => {
  const cards = [card("a", "2026-08-17T06:00:00.000Z"), card("b", "2026-08-20T06:00:00.000Z")];
  const from = startedDay("2026-08-17T06:00:00.000Z");
  const bounds = { from, to: startedDay("2026-08-20T06:00:00.000Z") };
  const nodes = layoutTimeline(cards, bounds, 16);
  const byId = new Map(nodes.map((node) => [node.cardId, node]));
  assert.equal(byId.get("a")?.x, 0);
  assert.equal(byId.get("b")?.x, 3 * 16);
});

test("layoutTimeline alternates root cards between the two sides", () => {
  const cards = [
    card("a", "2026-08-17T06:00:00.000Z"),
    card("b", "2026-08-25T06:00:00.000Z"),
    card("c", "2026-09-02T06:00:00.000Z"),
  ];
  const bounds = {
    from: startedDay("2026-08-17T06:00:00.000Z"),
    to: startedDay("2026-09-02T06:00:00.000Z"),
  };
  const sides = layoutTimeline(cards, bounds, 16)
    .sort((left, right) => left.x - right.x)
    .map((node) => node.side);
  assert.deepEqual(sides, ["top", "bottom", "top"]);
});

test("layoutTimeline keeps a child on the same side as its parent", () => {
  const cards = [
    card("a", "2026-08-17T06:00:00.000Z"),
    card("b", "2026-08-25T06:00:00.000Z"),
    card("a-child", "2026-09-02T06:00:00.000Z", "a"),
  ];
  const bounds = {
    from: startedDay("2026-08-17T06:00:00.000Z"),
    to: startedDay("2026-09-02T06:00:00.000Z"),
  };
  const byId = new Map(layoutTimeline(cards, bounds, 16).map((node) => [node.cardId, node]));
  assert.equal(byId.get("a-child")?.side, byId.get("a")?.side);
});

test("layoutTimeline stacks colliding cards into outer rows on the same side", () => {
  // 三張同一天的頂層卡：交錯後上側兩張、下側一張，上側兩張必須分列
  const cards = [
    card("a", "2026-08-17T06:00:00.000Z"),
    card("b", "2026-08-17T07:00:00.000Z"),
    card("c", "2026-08-17T08:00:00.000Z"),
  ];
  const from = startedDay("2026-08-17T06:00:00.000Z");
  const nodes = layoutTimeline(cards, { from, to: from }, 16);
  for (const side of ["top", "bottom"] as const) {
    const rows = nodes.filter((node) => node.side === side).map((node) => node.row);
    assert.equal(new Set(rows).size, rows.length);
  }
});

test("layoutTimeline puts far-apart cards on the same row", () => {
  const cards = [
    card("a", "2026-08-17T06:00:00.000Z"),
    card("b", "2026-11-17T06:00:00.000Z"),
  ];
  const bounds = {
    from: startedDay("2026-08-17T06:00:00.000Z"),
    to: startedDay("2026-11-17T06:00:00.000Z"),
  };
  const nodes = layoutTimeline(cards, bounds, 32);
  assert.equal(nodes.every((node) => node.row === 0), true);
  assert.equal(
    (nodes[1]?.x ?? 0) - (nodes[0]?.x ?? 0) > TIMELINE_CARD_WIDTH,
    true,
  );
});

test("layoutTimeline omits unstarted cards", () => {
  const cards = [card("a", "2026-08-17T06:00:00.000Z"), card("b", null)];
  const from = startedDay("2026-08-17T06:00:00.000Z");
  const nodes = layoutTimeline(cards, { from, to: from }, 16);
  assert.deepEqual(nodes.map((node) => node.cardId), ["a"]);
});
