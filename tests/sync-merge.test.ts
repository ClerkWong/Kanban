import assert from "node:assert/strict";
import test from "node:test";
import {
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
