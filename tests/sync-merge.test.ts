import assert from "node:assert/strict";
import test from "node:test";
import {
  addCard,
  assertBoardInvariants,
  createDemoBoard,
  deleteCard,
  moveCard,
  updateCard,
} from "../app/board-model";
import { mergeBoards } from "../app/sync/merge";

function later(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

test("卡片級 LWW：較新的 updatedAt 獲勝", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const a = updateCard(base, "card-roadmap", { title: "A 版標題" });
  const b = updateCard(base, "card-roadmap", { title: "B 版標題" });
  const bNewer = {
    ...b,
    cards: {
      ...b.cards,
      "card-roadmap": {
        ...b.cards["card-roadmap"],
        updatedAt: later(a.cards["card-roadmap"].updatedAt, 5000),
      },
    },
  };
  const merged = mergeBoards(a, bNewer);
  assert.equal(merged.cards["card-roadmap"].title, "B 版標題");
  assertBoardInvariants(merged);
});

test("較新的刪除擊敗較舊的編輯（不復活）", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const edited = updateCard(base, "card-copy", { title: "編輯過" });
  const deleted = deleteCard(base, "card-copy");
  const deletedNewer = {
    ...deleted,
    deletedCards: {
      ...deleted.deletedCards,
      "card-copy": later(edited.cards["card-copy"].updatedAt, 5000),
    },
  };
  const merged = mergeBoards(edited, deletedNewer);
  assert.equal(merged.cards["card-copy"], undefined);
  assert.equal(typeof merged.deletedCards["card-copy"], "string");
});

test("較新的編輯擊敗較舊的刪除（復活並清墓碑）", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const deleted = deleteCard(base, "card-copy");
  const edited = updateCard(base, "card-copy", { title: "復活" });
  const editedNewer = {
    ...edited,
    cards: {
      ...edited.cards,
      "card-copy": {
        ...edited.cards["card-copy"],
        updatedAt: later(deleted.deletedCards["card-copy"], 5000),
      },
    },
  };
  const merged = mergeBoards(deleted, editedNewer);
  assert.equal(merged.cards["card-copy"].title, "復活");
  assert.equal(merged.deletedCards["card-copy"], undefined);
});

test("欄位結構以 lastSavedAt 較新一方為準，另一方獨有卡片放回其原欄", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const moved = moveCard(base, "card-roadmap", "doing", 0);
  const withNew = updateCard(
    { ...base, lastSavedAt: later(moved.lastSavedAt, -60000) },
    "card-review",
    { title: "舊側編輯" },
  );
  const onlyInOld = {
    ...withNew,
    lastSavedAt: later(moved.lastSavedAt, -60000),
  };
  const merged = mergeBoards(moved, onlyInOld);
  const doing = merged.columns.find((column) => column.id === "doing");
  assert.ok(doing?.cardIds.includes("card-roadmap"));
  assertBoardInvariants(merged);
});

test("同步合併依卡片更新時間收斂 completedAt 與完成欄位置", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const earlier = moveCard(
    base,
    "card-roadmap",
    "done",
    0,
    new Date("2026-07-20T09:00:00.000Z"),
  );
  const later = moveCard(
    base,
    "card-roadmap",
    "done",
    0,
    new Date("2026-07-21T09:00:00.000Z"),
  );

  const merged = mergeBoards(earlier, later);
  assert.equal(merged.cards["card-roadmap"].completedAt, "2026-07-21T09:00:00.000Z");
  assert.equal(merged.cards["card-roadmap"].updatedAt, "2026-07-21T09:00:00.000Z");
  assert.ok(merged.columns.find((column) => column.id === "done")?.cardIds.includes("card-roadmap"));
  assertBoardInvariants(merged);
});

test("較新的重開卡片不會被較新的遠端欄位結構留在 Done", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const initiallyDone = moveCard(
    base,
    "card-roadmap",
    "done",
    0,
    new Date("2026-07-20T09:00:00.000Z"),
  );
  const localReopened = moveCard(
    initiallyDone,
    "card-roadmap",
    "todo",
    0,
    new Date("2026-07-21T09:00:00.000Z"),
  );
  const remoteWithLaterLayout = {
    ...initiallyDone,
    cards: {
      ...initiallyDone.cards,
      "card-copy": {
        ...initiallyDone.cards["card-copy"],
        updatedAt: "2026-07-22T09:00:00.000Z",
      },
    },
    lastSavedAt: "2026-07-22T09:00:00.000Z",
  };

  const merged = mergeBoards(localReopened, remoteWithLaterLayout);
  assert.equal(merged.cards["card-roadmap"].completedAt, null);
  assert.ok(merged.columns.find((column) => column.id === "todo")?.cardIds.includes("card-roadmap"));
  assert.equal(
    merged.columns.find((column) => column.id === "done")?.cardIds.includes("card-roadmap"),
    false,
  );
  assertBoardInvariants(merged);
});

test("合併結果通過不變量且冪等", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const a = deleteCard(updateCard(base, "card-roadmap", { title: "X" }), "card-done");
  const b = moveCard(updateCard(base, "card-copy", { priority: "high" }), "card-review", "done", 0);
  const merged = mergeBoards(a, b);
  assertBoardInvariants(merged);
  const again = mergeBoards(merged, merged);
  assert.deepEqual(
    { cards: Object.keys(again.cards).sort(), deleted: Object.keys(again.deletedCards).sort() },
    { cards: Object.keys(merged.cards).sort(), deleted: Object.keys(merged.deletedCards).sort() },
  );
});

test("合併保留敗方獨有且含卡片的欄位", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  // 遠端（敗方）：新增欄位並放入一張卡
  const remote = {
    ...base,
    cards: {
      ...base.cards,
      "card-review": {
        ...base.cards["card-review"],
        updatedAt: later(base.cards["card-review"].updatedAt, 5000),
      },
    },
    columns: [
      ...base.columns.slice(0, 3),
      {
        id: "column-mobile-added",
        title: "行動端新欄",
        wipLimit: null,
        cardIds: ["card-review"],
      },
      base.columns[3],
    ].map((column) =>
      column.id === "review"
        ? { ...column, cardIds: column.cardIds.filter((id) => id !== "card-review") }
        : column,
    ),
  };
  // 本機（勝方）：lastSavedAt 較新，仍是原本四欄
  const local = { ...base, lastSavedAt: later(base.lastSavedAt, 60_000) };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  const added = merged.columns.find((column) => column.id === "column-mobile-added");
  assert.ok(added, "敗方獨有欄位不得被合併丟棄");
  assert.deepEqual(added?.cardIds, ["card-review"]);
  const doneIndex = merged.columns.findIndex((column) => column.id === "done");
  const addedIndex = merged.columns.findIndex((column) => column.id === "column-mobile-added");
  assert.ok(addedIndex < doneIndex, "保留欄位應插在完成欄之前");
});

test("合併不復活敗方獨有的空欄位", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  const remote = {
    ...base,
    columns: [
      ...base.columns.slice(0, 3),
      { id: "column-empty-old", title: "已刪空欄", wipLimit: null, cardIds: [] },
      base.columns[3],
    ],
  };
  const local = { ...base, lastSavedAt: later(base.lastSavedAt, 60_000) };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  assert.equal(
    merged.columns.some((column) => column.id === "column-empty-old"),
    false,
    "空的敗方獨有欄位視為已刪除，不應復活",
  );
});

test("合併時敗方獨有欄位標題撞名會加後綴", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  const remote = {
    ...base,
    cards: {
      ...base.cards,
      "card-review": {
        ...base.cards["card-review"],
        updatedAt: later(base.cards["card-review"].updatedAt, 5000),
      },
    },
    columns: [
      ...base.columns.slice(0, 3),
      // 標題與既有「審核中」欄相同（NFKC 大小寫不敏感比對）
      { id: "column-dup-title", title: "審核中", wipLimit: null, cardIds: ["card-review"] },
      base.columns[3],
    ].map((column) =>
      column.id === "review"
        ? { ...column, cardIds: column.cardIds.filter((id) => id !== "card-review") }
        : column,
    ),
  };
  const local = { ...base, lastSavedAt: later(base.lastSavedAt, 60_000) };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  const kept = merged.columns.find((column) => column.id === "column-dup-title");
  assert.ok(kept, "撞名欄位仍應保留");
  assert.notEqual(kept?.title, "審核中", "標題應調整以避免與既有欄位重複");
  const titles = merged.columns.map((column) => column.title.trim().normalize("NFKC").toLocaleLowerCase("zh-TW"));
  assert.equal(new Set(titles).size, titles.length, "合併後欄位標題不得重複");
});

test("卡片位置跟隨卡片級 LWW 來源欄位", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  // 遠端把 card-analytics 從 doing 移到 review，並 bump updatedAt（v7 跨欄移動行為）
  const remote = {
    ...base,
    cards: {
      ...base.cards,
      "card-analytics": {
        ...base.cards["card-analytics"],
        updatedAt: later(base.cards["card-analytics"].updatedAt, 5000),
      },
    },
    columns: base.columns.map((column) => {
      if (column.id === "doing") {
        return { ...column, cardIds: column.cardIds.filter((id) => id !== "card-analytics") };
      }
      if (column.id === "review") {
        return { ...column, cardIds: [...column.cardIds, "card-analytics"] };
      }
      return column;
    }),
  };
  const local = { ...base, lastSavedAt: later(base.lastSavedAt, 60_000) };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  assert.ok(
    merged.columns.find((column) => column.id === "review")?.cardIds.includes("card-analytics"),
    "遠端較新的跨欄移動應在合併結果中生效",
  );
});

test("敗方非空欄位在卡片移走後保留為空欄", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  // 敗方（遠端舊資料）：欄 X 仍持有 card-review
  const remote = {
    ...base,
    columns: [
      ...base.columns.slice(0, 3),
      { id: "column-x", title: "離線舊欄", wipLimit: null, cardIds: ["card-review"] },
      base.columns[3],
    ].map((column) =>
      column.id === "review"
        ? { ...column, cardIds: column.cardIds.filter((id) => id !== "card-review") }
        : column,
    ),
  };
  // 勝方（本機較新）：已把 card-review 移回 review 欄（updatedAt 較新），且沒有欄 X
  const local = {
    ...base,
    cards: {
      ...base.cards,
      "card-review": {
        ...base.cards["card-review"],
        updatedAt: later(base.cards["card-review"].updatedAt, 5000),
      },
    },
    lastSavedAt: later(base.lastSavedAt, 60_000),
  };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  const kept = merged.columns.find((column) => column.id === "column-x");
  assert.ok(kept, "敗方板上非空的欄位必須保留（即使合併後變空），否則 Worker 會拒絕推送");
  assert.deepEqual(kept?.cardIds, []);
  assert.ok(
    merged.columns.find((column) => column.id === "review")?.cardIds.includes("card-review"),
  );
});

test("欄位聯集不超過上限，超額敗方欄位的卡片落回第一欄", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  // 勝方撐滿 20 欄
  const fillerCount = 20 - base.columns.length;
  const local = {
    ...base,
    columns: [
      ...base.columns.slice(0, 3),
      ...Array.from({ length: fillerCount }, (_, i) => ({
        id: `column-filler-${i}`,
        title: `補位欄 ${i + 1}`,
        wipLimit: null,
        cardIds: [],
      })),
      base.columns[3],
    ],
    lastSavedAt: later(base.lastSavedAt, 60_000),
  };
  // 敗方另有一個非空獨有欄
  const remote = {
    ...base,
    cards: {
      ...base.cards,
      "card-review": {
        ...base.cards["card-review"],
        updatedAt: later(base.cards["card-review"].updatedAt, 5000),
      },
    },
    columns: [
      ...base.columns.slice(0, 3),
      { id: "column-overflow", title: "超額欄", wipLimit: null, cardIds: ["card-review"] },
      base.columns[3],
    ].map((column) =>
      column.id === "review"
        ? { ...column, cardIds: column.cardIds.filter((id) => id !== "card-review") }
        : column,
    ),
  };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  assert.ok(merged.columns.length <= 20, "合併結果不得超過欄位上限");
  assert.equal(merged.columns.some((column) => column.id === "column-overflow"), false);
  assert.ok(
    merged.columns.find((column) => column.id === "review")?.cardIds.includes("card-review"),
    "被捨棄欄位的卡片應回到勝方持有它的欄位",
  );
});

test("撞名後綴在滿長標題下仍唯一且不超過長度上限", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  const longTitle = "甲".repeat(40);
  const withLong = {
    ...base,
    columns: base.columns.map((column) =>
      column.id === "review" ? { ...column, title: longTitle } : column,
    ),
  };
  const remote = {
    ...withLong,
    cards: {
      ...withLong.cards,
      "card-review": {
        ...withLong.cards["card-review"],
        updatedAt: later(withLong.cards["card-review"].updatedAt, 5000),
      },
    },
    columns: [
      ...withLong.columns.slice(0, 3),
      { id: "column-long-dup", title: longTitle, wipLimit: null, cardIds: ["card-review"] },
      withLong.columns[3],
    ].map((column) =>
      column.id === "review"
        ? { ...column, cardIds: column.cardIds.filter((id) => id !== "card-review") }
        : column,
    ),
  };
  const local = { ...withLong, lastSavedAt: later(withLong.lastSavedAt, 60_000) };

  const merged = mergeBoards(local, remote);

  assertBoardInvariants(merged);
  const titles = merged.columns.map((column) =>
    column.title.trim().normalize("NFKC").toLocaleLowerCase("zh-TW"),
  );
  assert.equal(new Set(titles).size, titles.length);
  for (const column of merged.columns) {
    assert.ok(column.title.length <= 40, `標題超長：${column.title}`);
  }
});

test("兩台裝置以相反順序合併收斂到同一結果", () => {
  const base = createDemoBoard(new Date(2026, 7, 1));
  // 裝置 A：移動 card-analytics 到 review（較新）
  const a = {
    ...base,
    cards: {
      ...base.cards,
      "card-analytics": {
        ...base.cards["card-analytics"],
        updatedAt: later(base.cards["card-analytics"].updatedAt, 5000),
      },
    },
    columns: base.columns.map((column) => {
      if (column.id === "doing") {
        return { ...column, cardIds: column.cardIds.filter((id) => id !== "card-analytics") };
      }
      if (column.id === "review") {
        return { ...column, cardIds: [...column.cardIds, "card-analytics"] };
      }
      return column;
    }),
    lastSavedAt: later(base.lastSavedAt, 60_000),
  };
  // 裝置 B：新增欄位並移入 card-copy（updatedAt 較新但 lastSavedAt 較舊）
  const b = {
    ...base,
    cards: {
      ...base.cards,
      "card-copy": {
        ...base.cards["card-copy"],
        updatedAt: later(base.cards["card-copy"].updatedAt, 3000),
      },
    },
    columns: [
      ...base.columns.slice(0, 3),
      { id: "column-b-new", title: "B 新欄", wipLimit: null, cardIds: ["card-copy"] },
      base.columns[3],
    ].map((column) =>
      column.id === "doing"
        ? { ...column, cardIds: column.cardIds.filter((id) => id !== "card-copy") }
        : column,
    ),
    lastSavedAt: later(base.lastSavedAt, 30_000),
  };

  const ab = mergeBoards(a, b);
  const ba = mergeBoards(b, a);

  assertBoardInvariants(ab);
  assertBoardInvariants(ba);
  assert.deepEqual(
    { columns: ab.columns, cards: ab.cards, deletedCards: ab.deletedCards },
    { columns: ba.columns, cards: ba.cards, deletedCards: ba.deletedCards },
    "相反順序合併必須收斂",
  );
});

test("merging two acyclic boards never produces a cycle", () => {
  // local：b 的父是 a，且 b.updatedAt 較新，卡片級 LWW 會採用 local 這張 b。
  // remote：a 的父是 b，且 a.updatedAt 較新，卡片級 LWW 會採用 remote 這張 a。
  // 兩條連結各自在較新的一側存活，合併後、normalizeBoard 收斂前會短暫形成環，
  // 交給 mergeBoards 結尾既有的 normalizeBoard 呼叫斷開——這裡只是把保證釘住。
  const base = createDemoBoard(new Date(2026, 7, 1));
  const withA = addCard(base, base.columns[0].id, { id: "a", title: "a" });
  const withAB = addCard(withA, withA.columns[0].id, { id: "b", title: "b" });

  const local = {
    ...withAB,
    cards: {
      ...withAB.cards,
      b: {
        ...withAB.cards.b,
        parentCardId: "a",
        updatedAt: later(withAB.cards.b.updatedAt, 5000),
      },
    },
  };
  const remote = {
    ...withAB,
    cards: {
      ...withAB.cards,
      a: {
        ...withAB.cards.a,
        parentCardId: "b",
        updatedAt: later(withAB.cards.a.updatedAt, 5000),
      },
    },
  };

  const merged = mergeBoards(local, remote);

  // 兩張卡都保留，但只有一條連結存活（不會是 a↔b 互指）。
  assert.equal(merged.cards.a === undefined || merged.cards.b === undefined, false);
  assert.equal(merged.cards.a.parentCardId === "b" && merged.cards.b.parentCardId === "a", false);
  assert.doesNotThrow(() => assertBoardInvariants(merged));
});

// 審查發現同一種原型鏈寫法在 merge.ts 的 `local.cards[cardId]`／
// `remote.cards[cardId]`／`source.cards[cardId]` 也存在：cardId 為
// "constructor" 等名稱、且只有一側真的有這張卡片時，沒有這張卡片的那一側
// `xxx.cards[cardId]` 會落到繼承屬性（一個函式，truthy），被誤判成「這側也有
// 這張卡」。若當時的勝方（source）恰好落在這個沒有真卡片的一側，
// `candidate = source.cards[cardId]` 會拿到那個函式而不是 undefined，寫進
// 合併結果的 `cards[cardId]`；normalizeBoard 收尾時 normalizeCards 發現這個值
// 的 typeof 是 "function" 不是 "object"，會把它濾掉——原本只存在於另一側的
// 真實卡片就此从合併結果裡憑空消失，而不是像正常「單邊獨有」那樣被保留。
test("merging a card whose id collides with a prototype property name is not silently dropped", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const poisonedId = "constructor";
  const local = {
    ...base,
    cards: {
      ...base.cards,
      [poisonedId]: { ...base.cards["card-roadmap"], id: poisonedId, title: "只有 local 有這張卡" },
    },
    columns: base.columns.map((column) =>
      column.id === "todo" ? { ...column, cardIds: [...column.cardIds, poisonedId] } : column,
    ),
  };
  // remote 完全沒有這張卡片，但 lastSavedAt 較新讓 remote 當 winner，逼
  // mergeBoards 走到 `source.cards[cardId]` = `remote.cards["constructor"]`
  // 這條原型鏈查找路徑（若 winner 落在 local 一側，candidate 會恰好正確，
  // 測不出問題——這正是這條測試刻意讓 remote 當 winner 的理由）。
  const remote = { ...base, lastSavedAt: later(local.lastSavedAt, 5000) };

  const merged = mergeBoards(local, remote);
  assertBoardInvariants(merged);
  assert.equal(merged.cards[poisonedId]?.title, "只有 local 有這張卡");
});

// 同一個函式裡處理 deletedCards 合併的 `!deletedCards[cardId]` 也是同一種寫法：
// cardId 為 "constructor" 時，若 loser 側沒有這筆 tombstone（不是自身鍵），
// 會落到繼承屬性（truthy）被誤判成「已有更新的 tombstone」，winner 側真正的
// 刪除記錄就此在合併時被跳過、丟失。
test("merging a tombstone whose card id collides with a prototype property name is not dropped", () => {
  const base = createDemoBoard(new Date(2026, 6, 20));
  const poisonedId = "constructor";
  const local = base; // loser：沒有這筆 tombstone（deletedCards 裡沒有這個鍵）
  const remote = {
    ...base,
    lastSavedAt: later(base.lastSavedAt, 5000), // remote 當 winner
    deletedCards: { ...base.deletedCards, [poisonedId]: later(base.lastSavedAt, 1000) },
  };

  const merged = mergeBoards(local, remote);
  assertBoardInvariants(merged);
  assert.equal(typeof merged.deletedCards[poisonedId], "string");
});
