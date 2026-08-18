import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  MAX_CARD_DEPTH,
  addCard,
  assertBoardInvariants,
  cardDepth,
  createDemoBoard,
  deleteCard,
  descendantCardIds,
  eligibleParentCards,
  getBoardStats,
  normalizeBoard,
  parsePersistedBoard,
  subtreeHeight,
  updateCard,
  type BoardState,
  type Card,
} from "../app/board-model";

/** 只組出層級測試需要的欄位，其餘交給 normalizeBoard 補齊。 */
function boardWith(links: Record<string, string | null>): BoardState {
  const cards: Record<string, Card> = {};
  for (const [id, parentCardId] of Object.entries(links)) {
    cards[id] = {
      id,
      title: id,
      parentCardId,
    } as Card;
  }
  return normalizeBoard({
    version: BOARD_SCHEMA_VERSION,
    labels: [],
    cards,
    deletedCards: {},
    columns: [
      { id: "todo", title: "待辦", wipLimit: null, cardIds: Object.keys(links) },
      { id: "done", title: "完成", wipLimit: null, cardIds: [] },
    ],
    lastSavedAt: "2026-08-18T00:00:00.000Z",
  } as never);
}

test("schema version is 9", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 9);
});

test("existing cards migrate to a null parent without inventing links", () => {
  const legacy = { ...createDemoBoard(), version: 8 };
  const migrated = normalizeBoard(legacy as never);
  assert.equal(migrated.version, 9);
  for (const card of Object.values(migrated.cards)) {
    assert.equal(card.parentCardId, null);
  }
});

// 上一個測試直接呼叫 normalizeBoard()，完全沒經過 parsePersistedBoard() 的版本
// 白名單（app/board-model.ts 的 `version !== 8 && ... version !== BOARD_SCHEMA_VERSION`
// 那段）。白名單本身是純手工維護的條列式清單，下次升版若忘記加一行、或重構時
// 不小心漏掉，使用者本機現役的 v8 看板會被判定為不相容、整份換成示範資料——
// 且如果只測 normalizeBoard()，這個迴歸不會讓任何測試轉紅。這裡改成真正打
// parsePersistedBoard()，確保白名單缺一行時測試會壞。
test("parsePersistedBoard migrates a serialized v8 board to v9 with a null parent", () => {
  const legacy = JSON.stringify({ ...createDemoBoard(), version: 8 });

  const parsed = parsePersistedBoard(legacy);

  assert.equal(parsed.recovered, false);
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 9);
  for (const card of Object.values(parsed.board.cards)) {
    assert.equal(card.parentCardId, null);
  }
});

test("a parent pointing at a missing card is cleared", () => {
  const board = boardWith({ a: "ghost" });
  assert.equal(board.cards.a.parentCardId, null);
});

test("a self reference is cleared", () => {
  const board = boardWith({ a: "a" });
  assert.equal(board.cards.a.parentCardId, null);
});

// 審查發現：正規化第一步用 `!cards[parentCardId]` 判斷父卡是否存在，這是原型鏈
// 屬性查找。cards 的原型是 Object.prototype，parentCardId 為 "constructor"／
// "__proto__" 時 `cards[parentCardId]` 會落到繼承屬性（皆為 truthy），存在性
// 判斷被繞過，壞連結不會被清掉，接著第二步（斷環）沿著這條「看似存在」的連結
// 往上走，在它自己的 .parentCardId（undefined，不是 null）處誤判成「還沒到頂」
// 再走一步、查詢字面鍵 "undefined"（真的不存在）才對 undefined 取
// .parentCardId，normalizeBoard 因此拋出
// `TypeError: Cannot read properties of undefined (reading 'parentCardId')`。
for (const poisoned of ["constructor", "__proto__"]) {
  test(`a parentCardId of ${poisoned} does not crash normalizeBoard and is cleared`, () => {
    const board = boardWith({ a: poisoned });
    assert.equal(board.cards.a.parentCardId, null);
  });
}

test("a two-card cycle is broken", () => {
  const board = boardWith({ a: "b", b: "a" });
  const links = [board.cards.a.parentCardId, board.cards.b.parentCardId];
  assert.equal(links.filter((link) => link === null).length, 1);
  assert.equal(cardDepth(board.cards, "a") <= MAX_CARD_DEPTH, true);
  assert.equal(cardDepth(board.cards, "b") <= MAX_CARD_DEPTH, true);
});

test("a three-card cycle is broken", () => {
  const board = boardWith({ a: "c", b: "a", c: "b" });
  const cleared = ["a", "b", "c"].filter((id) => board.cards[id].parentCardId === null);
  assert.equal(cleared.length, 1);
});

test("a chain deeper than the limit is truncated to the top level", () => {
  const board = boardWith({ a: null, b: "a", c: "b", d: "c" });
  for (const id of ["a", "b", "c", "d"]) {
    assert.equal(cardDepth(board.cards, id) <= MAX_CARD_DEPTH, true);
  }
});

test("a chain at exactly the limit is preserved", () => {
  const board = boardWith({ a: null, b: "a", c: "b" });
  assert.equal(board.cards.b.parentCardId, "a");
  assert.equal(board.cards.c.parentCardId, "b");
  assert.equal(cardDepth(board.cards, "c"), 3);
});

test("normalizeBoard is idempotent with every kind of broken link present", () => {
  const board = boardWith({
    a: "ghost", b: "b", c: "d", d: "c", e: null, f: "e", g: "f", h: "g",
  });
  const twice = normalizeBoard(board);
  assert.deepEqual(twice, board);
});

test("cardDepth counts the top level as 1", () => {
  const board = boardWith({ a: null, b: "a", c: "b" });
  assert.equal(cardDepth(board.cards, "a"), 1);
  assert.equal(cardDepth(board.cards, "b"), 2);
  assert.equal(cardDepth(board.cards, "c"), 3);
});

// cardDepth／subtreeHeight 是匯出函式，可能被直接餵未經 normalizeCardHierarchy
// 正規化的 cards（例如 eligibleParentCards 在正規化完成前被呼叫）。這裡直接構造
// 一筆帶壞連結的 Record，不透過 boardWith／normalizeBoard，才能測到函式本身
// 的存在性判斷，而不是測到正規化已經先清過連結。
test("cardDepth does not treat a prototype property name as an existing ancestor", () => {
  const cards: Record<string, Card> = {
    a: { id: "a", title: "a", parentCardId: "constructor" } as Card,
  };
  assert.equal(cardDepth(cards, "a"), 1);
});

test("descendantCardIds collects the whole subtree but not the card itself", () => {
  const board = boardWith({ a: null, b: "a", c: "b", x: null });
  assert.deepEqual([...descendantCardIds(board.cards, "a")].sort(), ["b", "c"]);
  assert.deepEqual([...descendantCardIds(board.cards, "c")], []);
  assert.deepEqual([...descendantCardIds(board.cards, "x")], []);
});

test("subtreeHeight counts a leaf as 1", () => {
  const board = boardWith({ a: null, b: "a", c: "b" });
  assert.equal(subtreeHeight(board.cards, "c"), 1);
  assert.equal(subtreeHeight(board.cards, "b"), 2);
  assert.equal(subtreeHeight(board.cards, "a"), 3);
});

test("eligibleParentCards excludes self, descendants and targets that would exceed the depth limit", () => {
  const board = boardWith({ a: null, b: "a", c: "b", x: null });
  // c 是葉節點（高度 1），可掛在深度 <= 2 的卡下：a(1)、b(2)、x(1)
  assert.deepEqual(eligibleParentCards(board.cards, "c").sort(), ["a", "b", "x"]);
  // b 的子樹高度 2，只能掛在深度 <= 1 的卡下：a、x
  assert.deepEqual(eligibleParentCards(board.cards, "b").sort(), ["a", "x"]);
  // a 的子樹高度 3，沒有任何卡可以當它的父卡
  assert.deepEqual(eligibleParentCards(board.cards, "a"), []);
});

test("deleting a parent promotes its children to the top level", () => {
  const board = boardWith({ a: null, b: "a", c: "a" });
  const next = deleteCard(board, "a");
  assert.equal(next.cards.a, undefined);
  assert.equal(next.cards.b.parentCardId, null);
  assert.equal(next.cards.c.parentCardId, null);
});

test("assertBoardInvariants rejects a cycle", () => {
  const board = boardWith({ a: null, b: "a" });
  const broken = {
    ...board,
    cards: {
      ...board.cards,
      a: { ...board.cards.a, parentCardId: "b" },
    },
  };
  assert.throws(() => assertBoardInvariants(broken), /cycle/);
});

test("assertBoardInvariants rejects a chain deeper than the limit", () => {
  const board = boardWith({ a: null, b: "a", c: "b" });
  const broken = {
    ...board,
    cards: {
      ...board.cards,
      d: { ...board.cards.c, id: "d", parentCardId: "c" },
    },
    columns: board.columns.map((column) =>
      column.id === "todo" ? { ...column, cardIds: [...column.cardIds, "d"] } : column),
  };
  assert.throws(() => assertBoardInvariants(broken), /maximum depth/);
});

// 同一個原型鏈繞過，但站在 assertBoardInvariants 這一側：手動把已正規化過的卡片
// 改壞（不重跑 normalizeCardHierarchy），模擬「呼叫端直接把未經正規化的資料
// 交給 assertBoardInvariants」的情境。修補前，缺父卡檢查（`!board.cards[x]`）
// 被繞過、不會在這裡拋錯，接著環/深度檢查那段的
// `current = board.cards[current].parentCardId` 沒有存在性防護，會在走到字面
// 鍵 "undefined" 時對 undefined 取 .parentCardId 而拋出
// TypeError，而不是預期的「missing parent」錯誤。
test("assertBoardInvariants rejects a parentCardId that collides with a prototype property name", () => {
  const board = boardWith({ a: null });
  const broken = {
    ...board,
    cards: {
      ...board.cards,
      a: { ...board.cards.a, parentCardId: "constructor" },
    },
  };
  assert.throws(() => assertBoardInvariants(broken), /missing parent/);
});

test("the hierarchy does not affect completion, WIP or aging", () => {
  // 核心約束：子任務沒完成，父任務也可能已達成目標。把 b 掛到 a 底下，
  // a 的完成狀態與看板統計都不得改變。
  const board = createDemoBoard();
  const [parentId, childId] = Object.keys(board.cards);
  // 固定 today，否則跨日執行時 overdue 會漂移
  const before = getBoardStats(board, "2026-08-18");
  const linked = updateCard(board, childId, { parentCardId: parentId });
  const after = getBoardStats(linked, "2026-08-18");
  assert.deepEqual(after.total, before.total);
  assert.deepEqual(after.completed, before.completed);
  assert.deepEqual(after.overdue, before.overdue);
  assert.equal(linked.cards[parentId].completedAt, board.cards[parentId].completedAt);
});

test("addCard and updateCard keep an unknown parent out of the board", () => {
  const board = createDemoBoard();
  const created = addCard(board, board.columns[0].id, {
    title: "子任務",
    parentCardId: "ghost",
  });
  const child = Object.values(created.cards).find((card) => card.title === "子任務");
  assert.equal(child?.parentCardId, null);

  const parentId = Object.keys(board.cards)[0];
  const linked = updateCard(created, child!.id, { parentCardId: parentId });
  assert.equal(linked.cards[child!.id].parentCardId, parentId);
});
