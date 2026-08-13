import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  addCard,
  createDemoBoard,
  normalizeAssignmentWindows,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
} from "../app/board-model";

const ALICE = "11111111-2222-4333-8444-555555555555";
const BOB = "22222222-3333-4444-8555-666666666666";

test("schema version is 8", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 8);
});

test("normalizeAssignmentWindows keeps only windows whose userId is assigned", () => {
  const result = normalizeAssignmentWindows(
    [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
      { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-12" },
    ],
    [ALICE],
  );
  assert.deepEqual(result, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
});

test("normalizeAssignmentWindows drops malformed entries", () => {
  const result = normalizeAssignmentWindows(
    [
      "scalar",
      null,
      { userId: ALICE, startDate: "2026-8-7", endDate: "2026-08-13" },
      { userId: ALICE, startDate: "2026-08-13", endDate: "2026-08-07" },
      { userId: ALICE, startDate: "2026-08-07", endDate: "" },
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-07" },
    ],
    [ALICE],
  );
  assert.deepEqual(result, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-07" },
  ]);
});

test("normalizeAssignmentWindows keeps the first entry per user and sorts by userId", () => {
  const result = normalizeAssignmentWindows(
    [
      { userId: BOB, startDate: "2026-08-01", endDate: "2026-08-02" },
      { userId: ALICE, startDate: "2026-08-03", endDate: "2026-08-04" },
      { userId: BOB, startDate: "2026-08-09", endDate: "2026-08-10" },
    ],
    [ALICE, BOB],
  );
  assert.deepEqual(result, [
    { userId: ALICE, startDate: "2026-08-03", endDate: "2026-08-04" },
    { userId: BOB, startDate: "2026-08-01", endDate: "2026-08-02" },
  ]);
});

test("normalizeAssignmentWindows caps the array at 20 entries", () => {
  const ids = Array.from({ length: 25 }, (_, index) =>
    `${String(index + 10).padStart(8, "0")}-2222-4333-8444-555555555555`);
  const windows = ids.map((userId) => ({
    userId,
    startDate: "2026-08-07",
    endDate: "2026-08-08",
  }));
  assert.equal(normalizeAssignmentWindows(windows, ids).length, 20);
});

test("normalizeAssignmentWindows returns an empty array for absent or scalar input", () => {
  assert.deepEqual(normalizeAssignmentWindows(undefined, [ALICE]), []);
  assert.deepEqual(normalizeAssignmentWindows("nope", [ALICE]), []);
});

test("normalizeBoard is idempotent with orphan windows present", () => {
  const board = createDemoBoard();
  const cardId = Object.keys(board.cards)[0];
  board.cards[cardId] = {
    ...board.cards[cardId],
    assigneeUserIds: [ALICE],
    assignmentWindows: [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
      { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-13" },
    ],
  };
  const once = normalizeBoard(board);
  const twice = normalizeBoard(once);
  assert.deepEqual(once.cards[cardId].assignmentWindows, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
  assert.deepEqual(twice, once);
});

test("addCard stores windows only for assigned users", () => {
  const board = createDemoBoard();
  const next = addCard(board, board.columns[0].id, {
    title: "排程卡",
    assigneeUserIds: [ALICE],
    assignmentWindows: [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
      { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-13" },
    ],
  });
  const card = Object.values(next.cards).find((entry) => entry.title === "排程卡");
  assert.deepEqual(card?.assignmentWindows, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
});

test("removing an assignee drops that assignee's window", () => {
  const board = createDemoBoard();
  const created = addCard(board, board.columns[0].id, {
    title: "共同任務",
    assigneeUserIds: [ALICE, BOB],
    assignmentWindows: [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
      { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-12" },
    ],
  });
  const cardId = Object.values(created.cards)
    .find((entry) => entry.title === "共同任務")!.id;
  const next = updateCard(created, cardId, { assigneeUserIds: [ALICE] });
  assert.deepEqual(next.cards[cardId].assignmentWindows, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
});

test("existing cards migrate to an empty window list without inventing dates", () => {
  const legacy = {
    ...createDemoBoard(),
    version: 7,
  };
  const migrated = normalizeBoard(legacy as never);
  assert.equal(migrated.version, 8);
  for (const card of Object.values(migrated.cards)) {
    assert.deepEqual(card.assignmentWindows, []);
  }
});

// 上一個測試用 createDemoBoard() 展開後改 version，但示範看板的卡片本來就沒有
// assignmentWindows 資料、展開後也還是會落成空陣列，測試訊號偏弱：即使
// normalizeCards 忘了處理缺欄位、只是單純把 raw 物件原樣塞回去，這個測試一樣會
// 過。這裡改成手工組一個「卡片物件完全沒有 assignmentWindows 鍵」的 v7 board，
// 不透過 createDemoBoard，確保驗證的是 normalizeCards 真的會替缺項欄位補上
// 預設值，而不是恰好沿用了示範資料裡已經存在的空陣列。
test("a hand-built v7 board whose cards have no assignmentWindows key migrates to an empty list", () => {
  const handBuilt = {
    version: 7,
    labels: [],
    cards: {
      "card-x": {
        id: "card-x",
        title: "手工卡片",
        description: "",
        priority: "medium",
        labelIds: [],
        dueDate: "",
        checklist: [],
        assigneeUserIds: [ALICE],
        blocked: false,
        blockedReason: "",
        blockedAt: null,
        members: [],
        attachments: [],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        completedAt: null,
        columnEnteredAt: "2026-08-01T00:00:00.000Z",
        startedAt: null,
        blockedMs: 0,
        serviceClass: "standard",
        // 刻意不含 assignmentWindows 鍵。
      },
    },
    deletedCards: {},
    columns: [
      { id: "todo", title: "待辦", wipLimit: null, cardIds: ["card-x"] },
      { id: "done", title: "完成", wipLimit: null, cardIds: [] },
    ],
    lastSavedAt: "2026-08-01T00:00:00.000Z",
    settings: { agingWarnDays: 3, agingAlertDays: 7, expediteWipLimit: 1 },
  };
  assert.ok(!("assignmentWindows" in handBuilt.cards["card-x"]));

  const migrated = normalizeBoard(handBuilt as never);

  assert.equal(migrated.version, 8);
  assert.equal(Object.keys(migrated.cards).length, 1);
  for (const card of Object.values(migrated.cards)) {
    assert.deepEqual(card.assignmentWindows, []);
  }
});

// 以上所有遷移測試都直接呼叫 normalizeBoard()，完全沒經過
// parsePersistedBoard() 的版本白名單（app/board-model.ts 的
// `version !== 7 && ... version !== BOARD_SCHEMA_VERSION` 那段）。白名單本身
// 是純手工維護的條列式清單，下次升版若忘記加一行、或重構時不小心漏掉，
// 使用者本機的 v7／v8 看板會被判定為不相容、整份換成示範資料——且如果只測
// normalizeBoard()，這個迴歸不會讓任何測試轉紅。這裡改成真正打
// parsePersistedBoard()，確保白名單缺一行時測試會壞。
test("parsePersistedBoard migrates a serialized v7 board to v8 with empty window lists", () => {
  const legacy = JSON.stringify({ ...createDemoBoard(), version: 7 });

  const parsed = parsePersistedBoard(legacy);

  assert.equal(parsed.recovered, false);
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 8);
  for (const card of Object.values(parsed.board.cards)) {
    assert.deepEqual(card.assignmentWindows, []);
  }
});

test("parsePersistedBoard round-trips a v8 board and preserves assignment window content", () => {
  const board = createDemoBoard();
  const withCard = addCard(board, board.columns[0].id, {
    title: "排程卡",
    assigneeUserIds: [ALICE],
    assignmentWindows: [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
    ],
  });
  const persisted = serializeBoard(withCard);

  const parsed = parsePersistedBoard(persisted);

  assert.equal(parsed.recovered, false);
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 8);
  const card = Object.values(parsed.board.cards).find((entry) => entry.title === "排程卡");
  assert.deepEqual(card?.assignmentWindows, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
});
