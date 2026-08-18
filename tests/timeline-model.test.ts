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

test("startedDay reads the process's current local timezone, not UTC", () => {
  // 上一個測試的斷言集合含 UTC 日，所以把實作換成
  // `toISOString().slice(0, 10)` 在任何時區都會全綠——那個 mutant 在 CI
  // 上完全測不出來。這裡動態切換 `process.env.TZ` 釘住兩個具體時區下的
  // 具體答案：Node 在同一個行程內重新指定 TZ 會立即生效於後續的
  // `Date` 本地取值（本機 Node v24 已驗證），所以不需要真的用不同時區
  // 啟動測試行程。切完記得還原，避免影響同檔案裡其他測試。
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14，全世界最早跨日的時區
    assert.equal(startedDay("2026-08-17T12:00:00.000Z"), "2026-08-18");
    process.env.TZ = "Pacific/Niue"; // UTC-11，全世界最晚跨日的時區之一
    assert.equal(startedDay("2026-08-17T12:00:00.000Z"), "2026-08-17");
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
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

test("layoutTimeline propagates side down a full depth-3 chain anchored on the bottom root", () => {
  // 上一個測試的 fixture 只有一個頂層卡 "a"，交錯規則下單一頂層必然落在
  // "top"（排序後 index 0 永遠是 top），所以「把子卡的繼承拿掉讓它落殘餘
  // 交錯」或「把子卡寫死成 top」這兩種壞掉的重構，測出來的子卡側別都可能
  // 剛好還是 "top"、跟父卡「碰巧」一致，測試測不出來。這裡故意用兩個頂層
  // 卡讓交錯結果一個 top、一個 bottom，深度鏈接在 bottom 那個根上——
  // 任何一種壞掉的繼承都會把 mid／leaf 誤判成 top，跟 root-bottom 的
  // 實際 side 不一致，這裡就會抓到。
  const cards = [
    card("root-top", "2026-08-17T06:00:00.000Z"),
    card("root-bottom", "2026-08-25T06:00:00.000Z"),
    card("mid", "2026-09-02T06:00:00.000Z", "root-bottom"),
    card("leaf", "2026-09-10T06:00:00.000Z", "mid"),
  ];
  const bounds = {
    from: startedDay("2026-08-17T06:00:00.000Z"),
    to: startedDay("2026-09-10T06:00:00.000Z"),
  };
  const byId = new Map(layoutTimeline(cards, bounds, 16).map((node) => [node.cardId, node]));
  const rootSide = byId.get("root-bottom")?.side;
  assert.equal(rootSide, "bottom"); // 先釘住 fixture 本身的前提沒有跑掉
  assert.equal(byId.get("mid")?.side, rootSide);
  assert.equal(byId.get("leaf")?.side, rootSide);
});

test("layoutTimeline anchors a started card to its own side when its immediate parent hasn't started", () => {
  // 正常業務情境（不是病態輸入）：root 已開工，被拆成子任務 mid，還沒人
  // 動 mid，但 mid 底下的 leaf 已經開工。leaf 的直屬父卡 mid 未開工，依
  // 規格「父卡未開工時子卡直接接主骨」，leaf 必須自己取得一個交錯的
  // side，不能沿著 mid 往上「借」root 的 side——這裡故意讓正確答案是
  // root=top、leaf=bottom（兩者不同側）：如果之後有人把演算法改成沿整條
  // parentCardId 鏈往上找第一個「已開工」祖先來繼承（跳過中間斷掉的
  // mid），leaf 會被誤判成跟 root 同側（top），這個斷言就會抓到。這也是
  // 交給 Task 5 的行為契約：BoardTimeline 判斷「要畫虛線斜接父卡、還是
  // 實線直接接主骨」時，看的正是「直屬父卡是否出現在這個函式的輸出裡」。
  const cards = [
    card("root", "2026-08-17T06:00:00.000Z"),
    card("mid", null, "root"),
    card("leaf", "2026-08-25T06:00:00.000Z", "mid"),
  ];
  const bounds = {
    from: startedDay("2026-08-17T06:00:00.000Z"),
    to: startedDay("2026-08-25T06:00:00.000Z"),
  };
  const byId = new Map(layoutTimeline(cards, bounds, 16).map((node) => [node.cardId, node]));
  assert.equal(byId.get("mid"), undefined); // mid 未開工，不佔時間軸位置
  assert.equal(byId.get("root")?.side, "top");
  assert.equal(byId.get("leaf")?.side, "bottom");
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

test("layoutTimeline still interleaves every started card when a subset forms a cycle among themselves", () => {
  // 正常資料經 normalizeBoard 不會出現這種環，但這個函式被元件直接呼叫、
  // 不能假設呼叫端一定正規化過（見模組頂部註解）。a／b 互為父子成環，
  // 兩者都跟頂層 c 不連通，從頂層出發的走訪碰不到，只能靠
  // layoutTimeline 內「殘餘」那段賦值（把跟任何頂層都不連通的已開工卡片
  // 視為各自獨立的頂層再交錯一次）撿回來取得正確的 side。若把那段刪掉，
  // a／b 不會整張消失（最終賦值那行的 `?? "top"` 防禦會接住它們），但
  // 兩張都會塌成同一側、不再正確交錯——這裡直接釘住 a=top、b=bottom
  // 兩個具體值，塌成同側時這個斷言會抓到。
  const cards = [
    card("a", "2026-08-17T06:00:00.000Z", "b"),
    card("b", "2026-08-18T06:00:00.000Z", "a"),
    card("c", "2026-08-19T06:00:00.000Z", null),
  ];
  const bounds = {
    from: startedDay("2026-08-17T06:00:00.000Z"),
    to: startedDay("2026-08-19T06:00:00.000Z"),
  };
  const byId = new Map(layoutTimeline(cards, bounds, 16).map((node) => [node.cardId, node]));
  assert.deepEqual([...byId.keys()].sort(), ["a", "b", "c"]);
  assert.equal(byId.get("a")?.side, "top");
  assert.equal(byId.get("b")?.side, "bottom");
});
