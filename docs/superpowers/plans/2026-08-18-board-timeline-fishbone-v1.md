# 看板時間軸魚骨圖 v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在單一看板上提供一張魚骨圖，任務以實際開工日為接點從時間軸長出，讓管理者看出任務的啟動節奏。

**Architecture:** Card schema 升到 v9，新增 `parentCardId` 作為純結構分解（不影響任何狀態計算）。魚骨圖完全在前端用已載入的 board 資料繪製——**不新增 Worker 端點、不新增權限**。排版計算全部收在純函式模組 `timeline-model.ts`；`BoardTimeline` 元件只負責繪製，並與看板共用 `BoardApp` 既有的 store、同步與卡片面板。

**Tech Stack:** TypeScript、React（vinext / Vite）、Cloudflare Workers、D1、node:test（前端）、Vitest + Cloudflare Workers pool（Worker runtime tests）。

**規格：** `docs/superpowers/specs/2026-08-18-board-timeline-fishbone-design.md`

## Global Constraints

- 所有使用者可見文案為繁體中文；註解與 commit 訊息亦為繁體中文。
- **父子關係與任務狀態完全無關**：完成、WIP、老化、Cycle Time、阻塞、加急排序全部各卡各算，不因父子改變任何一項。不提供子樹聚合計數。
- **`parentCardId` 缺席即通過**：Worker 對缺席欄位一律放行，否則舊看板的任何編輯都會 400（流動度量 v7、甘特圖 v8 的同型 lockout，不接受第三次）。
- **`parentCardId` 絕對不可加入 `assignmentSignature`**：那是 owner-only 指派收斂的機制，混入層級欄位會讓 member 一改上層任務就 403。
- `MAX_CARD_DEPTH = 3`（頂層為第 1 層，其下最多再兩層）。
- 接點一律取既有的 `Card.startedAt`，不新增「開工日」欄位。
- `startedAt` → 日期字串以**檢視者本地時區**取出，其後全部走 UTC 字串／天數算術。
- 桌面專用：`< 900px` 顯示引導訊息，CSS 專責切換，通知元素恆在 DOM。
- 阻塞與加急一律文字加樣式雙區隔，不只靠顏色。
- 縮放為離散每日像素寬 `8`、`12`、`16`、`24`、`32`，預設 `16`。

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| `app/board-model.ts` | `parentCardId` 型別、`normalizeCardHierarchy`、深度與子孫查詢、不變量、schema v9 |
| `app/components/board/shared.ts` | `CardDraft` 攜帶 `parentCardId` 與 draft↔card 轉換 |
| `app/projects/timeline-model.ts` | **新增**：純函式排版（日期映射、上下側、堆疊列、未啟動池、縮放級距） |
| `app/components/board/BoardTimeline.tsx` | **新增**：魚骨圖繪製，只吃排版結果 |
| `app/components/board/BoardApp.tsx` | `view` prop：渲染欄位或魚骨圖，共用 store、同步與卡片面板 |
| `app/components/board/DetailModal.tsx` | 「上層任務」選單 |
| `app/projects/navigation.ts` | board 路由新增 `view`，解析與序列化 `/timeline` |
| `app/components/projects/ProjectApp.tsx` | 把 `view` 傳進 `BoardApp` |
| `app/globals.css` | 魚骨圖樣式與 899px 斷點 |
| `worker-sync/src/boards.ts` | `requireValidCardHierarchy` 結構驗證 |
| `worker-sync/src/board-diff.ts` | Activity Log 新增 `parentCardId` 欄位 |

---

### Task 1: Card schema v9、層級正規化與查詢函式

**Files:**
- Modify: `app/board-model.ts`
- Modify: `app/components/board/shared.ts`
- Test: `tests/board-card-hierarchy.test.ts`（新增）

**Interfaces:**
- Produces:
  - `Card.parentCardId: string | null`
  - `export const MAX_CARD_DEPTH = 3`
  - `export function normalizeCardHierarchy(cards: Record<string, Card>): void`（原地修改）
  - `export function cardDepth(cards: Record<string, Card>, cardId: string): number`（頂層回 1）
  - `export function descendantCardIds(cards: Record<string, Card>, cardId: string): Set<string>`
  - `export function subtreeHeight(cards: Record<string, Card>, cardId: string): number`（葉節點回 1）
  - `export function eligibleParentCards(cards: Record<string, Card>, cardId: string): string[]`
  - `BOARD_SCHEMA_VERSION = 9`
  - `CardDraft.parentCardId: string | null`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/board-card-hierarchy.test.ts`：

```ts
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

test("a parent pointing at a missing card is cleared", () => {
  const board = boardWith({ a: "ghost" });
  assert.equal(board.cards.a.parentCardId, null);
});

test("a self reference is cleared", () => {
  const board = boardWith({ a: "a" });
  assert.equal(board.cards.a.parentCardId, null);
});

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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 3 "board-card-hierarchy"`
Expected: FAIL——`MAX_CARD_DEPTH`／`cardDepth` 等不存在，`BOARD_SCHEMA_VERSION` 是 8。

- [ ] **Step 3: 加型別與常數**

`app/board-model.ts` 頂端把版本改為 9：

```ts
export const BOARD_SCHEMA_VERSION = 9;
```

在 `MAX_ASSIGNMENT_WINDOWS_PER_CARD` 附近新增：

```ts
/** 卡片層級上限：頂層為第 1 層，其下最多再兩層。 */
export const MAX_CARD_DEPTH = 3;
```

`Card` 型別在 `assignmentWindows` 之後新增：

```ts
  /** 上層任務的卡片 id；null 表示直接掛在時間軸上。
   *  純結構分解：不影響完成、WIP、老化、Cycle Time 或加急排序的任何計算。 */
  parentCardId: string | null;
```

- [ ] **Step 4: 加層級查詢函式**

在 `normalizeAssignmentWindows` 附近新增。這四個函式都必須對含環的輸入終止——`normalizeBoard`
已保證無環，但它們也被 UI 直接呼叫，不能假設。

```ts
/** 卡片所在層級；頂層為 1。走訪上限 MAX_CARD_DEPTH + 1 層，含環輸入亦保證終止。 */
export function cardDepth(cards: Record<string, Card>, cardId: string): number {
  let depth = 1;
  let current = cards[cardId]?.parentCardId ?? null;
  const seen = new Set<string>([cardId]);
  while (current !== null && !seen.has(current) && cards[current]) {
    depth += 1;
    seen.add(current);
    if (depth > MAX_CARD_DEPTH + 1) break;
    current = cards[current].parentCardId;
  }
  return depth;
}

/** 該卡的全部子孫，不含自己。 */
export function descendantCardIds(
  cards: Record<string, Card>,
  cardId: string,
): Set<string> {
  const result = new Set<string>();
  const queue = [cardId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const [id, card] of Object.entries(cards)) {
      if (card.parentCardId === current && !result.has(id) && id !== cardId) {
        result.add(id);
        queue.push(id);
      }
    }
  }
  return result;
}

/** 以該卡為根的子樹高度；葉節點為 1。 */
export function subtreeHeight(cards: Record<string, Card>, cardId: string): number {
  const descendants = descendantCardIds(cards, cardId);
  let height = 1;
  for (const id of descendants) {
    let depth = 1;
    let current: string | null = cards[id]?.parentCardId ?? null;
    while (current !== null && current !== cardId && cards[current]) {
      depth += 1;
      current = cards[current].parentCardId;
      if (depth > MAX_CARD_DEPTH) break;
    }
    height = Math.max(height, depth + 1);
  }
  return height;
}

/** 可以當這張卡上層任務的卡片 id：排除自己、自己的子孫，以及會讓自身子樹超過
 *  MAX_CARD_DEPTH 的目標。UI 用它產生選單，使用者就選不到必然被 Worker 400 擋下的值。 */
export function eligibleParentCards(
  cards: Record<string, Card>,
  cardId: string,
): string[] {
  const descendants = descendantCardIds(cards, cardId);
  const height = subtreeHeight(cards, cardId);
  return Object.keys(cards).filter((candidateId) => {
    if (candidateId === cardId || descendants.has(candidateId)) return false;
    return cardDepth(cards, candidateId) + height <= MAX_CARD_DEPTH;
  });
}
```

- [ ] **Step 5: 加層級正規化**

同一區塊新增。三步各自獨立，順序固定，且每一步都只會「清掉」連結、不會新增，因此整體幂等。

```ts
/** 原地修正三種壞連結。卡片 id 以字典序走訪以確保決定性；
 *  清連結只會讓深度變小，因此第二次執行不會再有變動。 */
export function normalizeCardHierarchy(cards: Record<string, Card>): void {
  const ids = Object.keys(cards).sort();

  // 1. 指向不存在的卡片，或指向自己
  for (const id of ids) {
    const parentCardId = cards[id].parentCardId;
    if (parentCardId !== null && (parentCardId === id || !cards[parentCardId])) {
      cards[id] = { ...cards[id], parentCardId: null };
    }
  }

  // 2. 斷環：從每張卡往上走，遇到已在本次路徑上的卡就斷掉造成閉合的那一條
  for (const id of ids) {
    const path = new Set<string>([id]);
    let current = id;
    while (cards[current].parentCardId !== null) {
      const parentCardId = cards[current].parentCardId as string;
      if (path.has(parentCardId)) {
        cards[current] = { ...cards[current], parentCardId: null };
        break;
      }
      path.add(parentCardId);
      current = parentCardId;
    }
  }

  // 3. 深度超過上限的降為頂層，而非整條鏈重排
  for (const id of ids) {
    if (cardDepth(cards, id) > MAX_CARD_DEPTH) {
      cards[id] = { ...cards[id], parentCardId: null };
    }
  }
}
```

- [ ] **Step 6: 接上 normalizeBoard 與三個寫入路徑**

`normalizeCards` 的卡片物件新增欄位（在 `assignmentWindows` 之後）。**這裡只做型別正規化，
關聯正確性交給第二輪**——`normalizeCards` 是逐卡迴圈，看不到完整卡片集合：

```ts
      parentCardId: typeof (raw as { parentCardId?: unknown }).parentCardId === "string"
        ? (raw as { parentCardId: string }).parentCardId
        : null,
```

`normalizeBoard`（`const cards = normalizeCards(board.cards);` 之後、`normalizeColumns` 之前）
插入第二輪：

```ts
  // 層級關聯需要完整卡片集合，因此在 normalizeCards 之後另跑一輪。
  normalizeCardHierarchy(cards);
```

`addCard` 的 card 物件新增 `parentCardId: typeof input.parentCardId === "string" ? input.parentCardId : null,`；
`updateCard` 的 `next.cards[cardId]` 新增
`parentCardId: patch.parentCardId !== undefined ? patch.parentCardId : existing.parentCardId,`。
兩者的關聯正確性同樣由結尾的 `normalizeBoard` 收斂——`addCard` 帶不存在的父卡會被清為 null。

`parsePersistedBoard` 的版本白名單加入 8：

```ts
        version !== 7 &&
        version !== 8 &&
        version !== BOARD_SCHEMA_VERSION)
```

`deleteCard` **不需要改動**：它結尾已呼叫 `normalizeBoard`，子卡的 `parentCardId` 指向被刪
卡片時會由第 1 步清為 null。測試仍要明確斷言這個行為。

- [ ] **Step 7: 加不變量斷言**

`assertBoardInvariants` 尾端（加急順序檢查之後）新增：

```ts
  for (const cardId of cardIds) {
    const parentCardId = board.cards[cardId].parentCardId;
    if (parentCardId !== null && !board.cards[parentCardId]) {
      throw new Error(`Card ${cardId} points at a missing parent ${parentCardId}.`);
    }
    if (parentCardId === cardId) {
      throw new Error(`Card ${cardId} cannot be its own parent.`);
    }
  }
  // 環與深度一起走：往上走時重複造訪即為環。這裡不能改用 cardDepth——它遇到環會在
  // 回到起點時就停下並回傳一個小的值，偵測不到環。
  for (const cardId of cardIds) {
    const seen = new Set<string>([cardId]);
    let depth = 1;
    let current = board.cards[cardId].parentCardId;
    while (current !== null) {
      if (seen.has(current)) {
        throw new Error(`Card hierarchy contains a cycle at ${current}.`);
      }
      seen.add(current);
      depth += 1;
      if (depth > MAX_CARD_DEPTH) {
        throw new Error(`Card ${cardId} exceeds the maximum depth ${MAX_CARD_DEPTH}.`);
      }
      current = board.cards[current].parentCardId;
    }
  }
```

`seen` 只增不減，所以即使輸入含環也保證終止。

- [ ] **Step 8: 更新 draft 轉換**

`app/components/board/shared.ts`：`CardDraft` 在 `assignmentWindows` 之後加
`parentCardId: string | null;`；`createDraft` 回 `parentCardId: null`；`draftFromCard` 回
`parentCardId: card.parentCardId`；`draftToCardInput` 回 `parentCardId: draft.parentCardId`。

- [ ] **Step 9: 跑測試確認通過**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全綠。既有測試若因 schema 版本斷言而失敗，更新該斷言而非改回版本。

- [ ] **Step 10: 合併不會產生環**

`app/sync/merge.ts` 的 `mergeBoards` 結尾已呼叫 `normalizeBoard`，所以這是既有保證，
但要有測試釘住。加到 `tests/sync-merge.test.ts`：

```ts
test("merging two acyclic boards never produces a cycle", () => {
  // local: b 的父是 a；remote: a 的父是 b，且 a 的 updatedAt 較新
  // 合併後兩張卡都保留，但只有一條連結存活
  const merged = mergeBoards(localBoard, remoteBoard);
  assert.equal(merged.cards.a.parentCardId === "b" && merged.cards.b.parentCardId === "a", false);
  assert.doesNotThrow(() => assertBoardInvariants(merged));
});
```

fixture 請沿用該檔既有的 board 建構輔助，只補 `parentCardId` 與 `updatedAt`。

- [ ] **Step 11: Commit**

```bash
git add app/board-model.ts app/components/board/shared.ts tests/board-card-hierarchy.test.ts tests/sync-merge.test.ts
git commit -m "feat: card schema v9 加入上層任務關聯"
```

---

### Task 2: Worker 結構驗證與 Activity Log

**Files:**
- Modify: `worker-sync/src/boards.ts`（新增 `requireValidCardHierarchy`，並在三個呼叫點接上）
- Modify: `worker-sync/src/board-diff.ts`
- Test: `worker-sync/test/boards.integration.test.ts`

**Interfaces:**
- Consumes: 既有 `asRecord`、`RequestError`、`MAX_ASSIGNEES_PER_CARD` 所在檔案的慣例。
- Produces: Worker 對 `parentCardId` 的結構驗證；Activity Log 可記 `parentCardId` 欄位變更。

- [ ] **Step 1: 寫失敗測試**

在 `worker-sync/test/boards.integration.test.ts` 末端加入。**先讀完該檔的 fixture 區**，
下列 `putContent`、`boardWithCards`、`ownerToken`、`memberToken` 都是**佔位名稱**，
換成檔內實際的名稱與呼叫方式；缺的輔助以該檔既有風格補最小版本。

```ts
it("rejects a non-string non-null parentCardId", async () => {
  const board = boardWithCards({ c1: { parentCardId: 42 } });
  const response = await putContent(ownerToken, 1, board);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_card_hierarchy");
});

it("rejects a parentCardId pointing at a missing card", async () => {
  const board = boardWithCards({ c1: { parentCardId: "ghost" } });
  expect((await putContent(ownerToken, 1, board)).status).toBe(400);
});

it("rejects a self reference", async () => {
  const board = boardWithCards({ c1: { parentCardId: "c1" } });
  expect((await putContent(ownerToken, 1, board)).status).toBe(400);
});

it("rejects a two-card cycle", async () => {
  const board = boardWithCards({ c1: { parentCardId: "c2" }, c2: { parentCardId: "c1" } });
  expect((await putContent(ownerToken, 1, board)).status).toBe(400);
});

it("rejects a chain deeper than three", async () => {
  const board = boardWithCards({
    c1: { parentCardId: null }, c2: { parentCardId: "c1" },
    c3: { parentCardId: "c2" }, c4: { parentCardId: "c3" },
  });
  expect((await putContent(ownerToken, 1, board)).status).toBe(400);
});

it("accepts a chain at exactly three", async () => {
  const board = boardWithCards({
    c1: { parentCardId: null }, c2: { parentCardId: "c1" }, c3: { parentCardId: "c2" },
  });
  expect((await putContent(ownerToken, 1, board)).status).toBe(200);
});

it("lets a member change parentCardId", async () => {
  // 這條釘住 parentCardId 不在 assignmentSignature 內的界線
  const board = boardWithCards({
    c1: { parentCardId: null }, c2: { parentCardId: "c1" },
  });
  expect((await putContent(memberToken, 1, board)).status).toBe(200);
});

it("still forbids a member from changing assignees", async () => {
  const board = boardWithCards({ c1: { assigneeUserIds: [ALICE] } });
  expect((await putContent(memberToken, 1, board)).status).toBe(403);
});

it("lets a member edit a legacy board whose cards have no parentCardId key", async () => {
  await seedBoardData(boardWithoutParentKey());
  const next = boardWithoutParentKey({ title: "member 編輯" });
  expect((await putContent(memberToken, currentRevision, next)).status).toBe(200);
});

it("records parentCardId as a changed field in the activity log", async () => {
  await putContent(ownerToken, 1, boardWithCards({
    c1: { parentCardId: null }, c2: { parentCardId: "c1" },
  }));
  const logs = await readBoardLog(ownerToken);
  expect(JSON.stringify(logs)).toContain("parentCardId");
  expect(JSON.stringify(logs)).not.toContain("c1\",\"c2");
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm worker:test 2>&1 | tail -30`
Expected: FAIL——400 測試得到 200。

- [ ] **Step 3: 加結構驗證**

`worker-sync/src/boards.ts`，在 `requireValidAssignmentWindows`（約 line 117）之後新增。
**缺席即通過是刻意的**，理由見 Global Constraints：

```ts
/** 卡片層級上限，與 app/board-model.ts 的 MAX_CARD_DEPTH 一致。 */
const MAX_CARD_DEPTH = 3;

/** v8 舊 client 相容：`parentCardId` 缺席即通過，出現才驗格式。
 *  絕不能把缺席當成違規——現存所有 board 的卡片都沒有這個鍵，那會讓舊看板的任何編輯都 400。 */
function requireValidCardHierarchy(value: unknown): void {
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return;

  const parents = new Map<string, string>();
  for (const [cardId, raw] of Object.entries(cards)) {
    const card = asRecord(raw);
    if (!card || card.parentCardId === undefined || card.parentCardId === null) continue;
    const parentCardId = card.parentCardId;
    if (
      typeof parentCardId !== "string" ||
      !parentCardId ||
      parentCardId === cardId ||
      !cards[parentCardId]
    ) {
      throw new RequestError(400, "invalid_card_hierarchy");
    }
    parents.set(cardId, parentCardId);
  }

  for (const cardId of parents.keys()) {
    const seen = new Set<string>([cardId]);
    let depth = 1;
    let current: string | undefined = parents.get(cardId);
    while (current !== undefined) {
      if (seen.has(current)) throw new RequestError(400, "invalid_card_hierarchy");
      seen.add(current);
      depth += 1;
      if (depth > MAX_CARD_DEPTH) throw new RequestError(400, "invalid_card_hierarchy");
      current = parents.get(current);
    }
  }
}
```

- [ ] **Step 4: 接上三個呼叫點**

`requireValidAssignmentWindows` 目前在三處被呼叫（`createBoard` 約 line 504、
`putBoardContent` 約 line 812、`putLegacyRow` 約 line 908）。每一處緊接其後加一行：

```ts
  requireValidCardHierarchy(payload.board);
```

`createBoard` 那一處的參數是 `body.board`。**三處都要加**——甘特圖那次漏了 `createBoard`，
是審查才抓到的。

**不要**把 `parentCardId` 加進 `assignmentSignature`。它是 member 可改的欄位。

- [ ] **Step 5: Activity Log 欄位**

`worker-sync/src/board-diff.ts`：`CardField` union 加 `| "parentCardId"`；`CardSnapshot` 加
`parentCardId: unknown;`；snapshot 建構處加 `parentCardId: card.parentCardId ?? null,`；
diff 比較處加：

```ts
  if (!sameValue(before.parentCardId, after.parentCardId)) {
    fields.push("parentCardId");
  }
```

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm worker:test && pnpm typecheck && pnpm lint`
Expected: 全綠，既有 Worker 測試不受影響。

- [ ] **Step 7: Mutation 驗證兩條防線**

把 `requireValidCardHierarchy` 開頭的 `if (!cards) return;` 之後那句
`card.parentCardId === undefined` 拿掉（讓缺席被當成違規），確認「member 編輯 legacy board」
測試轉紅；復原。
再把 `parentCardId` 暫時加進 `assignmentSignature` 的逐卡輸出，確認「member 改 parentCardId」
測試轉紅（應得 403）；復原。

Run: `pnpm worker:test`
Expected: 復原後全綠，兩次 mutation 各有測試轉紅。

- [ ] **Step 8: Commit**

```bash
git add worker-sync/src/boards.ts worker-sync/src/board-diff.ts worker-sync/test/boards.integration.test.ts
git commit -m "feat: Worker 驗證上層任務關聯"
```

---

### Task 3: 純函式模組 `timeline-model.ts`

**Files:**
- Create: `app/projects/timeline-model.ts`
- Test: `tests/timeline-model.test.ts`（新增）

**Interfaces:**
- Consumes: `Card`（`app/board-model.ts`）。
- Produces:
  - `export const ZOOM_LEVELS = [8, 12, 16, 24, 32] as const`
  - `export const DEFAULT_PX_PER_DAY = 16`
  - `export const TIMELINE_CARD_WIDTH = 180`
  - `export function startedDay(startedAt: string): string`
  - `export function dayOffset(from: string, day: string): number`
  - `export function timelineBounds(cards: Card[], today: string): { from: string; to: string } | null`
  - `export function buildForest(cards: Card[]): { roots: string[]; childrenOf: Map<string, string[]> }`
  - `export function unstartedCards(cards: Card[]): Card[]`
  - `export type TimelineNode = { cardId: string; x: number; side: "top" | "bottom"; row: number }`
  - `export function layoutTimeline(cards: Card[], bounds: { from: string; to: string }, pxPerDay: number): TimelineNode[]`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/timeline-model.test.ts`。**日期一律寫死字串，不得用 `new Date()` 取今天**。

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 3 "timeline-model"`
Expected: FAIL，模組不存在。

- [ ] **Step 3: 實作模組**

建立 `app/projects/timeline-model.ts`。要點：

- `startedDay` 用 `Date` 的本地取值（`getFullYear`／`getMonth`／`getDate`）組出
  `YYYY-MM-DD`，**不要**用 `toISOString().slice(0, 10)`——那是 UTC 日，會讓卡片偏移一天。
- `dayOffset` 用 `Date.parse(\`${day}T00:00:00Z\`)` 相減除以 `86_400_000` 再 `Math.round`。
- `layoutTimeline`：先算每張已開工卡片的 `x`；`buildForest` 取得樹；頂層卡依
  `(x, cardId)` 排序後交錯指派 `side`（偶數 `top`、奇數 `bottom`）；子卡沿用父卡的 `side`
  （沿樹遞迴，深度已受 `MAX_CARD_DEPTH` 限制）；同一 `side` 內依 `x` 排序，貪婪指派 `row`：
  放進第一個「該列最後一張卡的右緣（`x + TIMELINE_CARD_WIDTH`）不超過本卡 `x`」的列，
  沒有就開新列。
- 排序鍵要完整到讓同一份輸入每次得到相同結果——Task 5 每次重繪都會呼叫它，配置跳動會讓
  畫面閃動。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全綠。

- [ ] **Step 5: 跨時區獨立驗算**

不要只信測試。用 `node -e` 在三個時區各跑一次 `startedDay` 與 `dayOffset`，其中一個要有
半小時偏移：

```bash
for TZ in Pacific/Kiritimati Pacific/Niue Asia/Kolkata; do TZ=$TZ npx tsx -e 'import {startedDay,dayOffset} from "./app/projects/timeline-model.ts"; console.log(process.env.TZ, startedDay("2026-08-17T12:00:00.000Z"), startedDay("2026-08-17T23:30:00.000Z"), dayOffset("2026-08-31","2026-09-01"));'; done
```

`dayOffset` 三個時區必須完全一致（它走 UTC）。`startedDay` 會因時區不同而不同——**這是
正確行為**，因為它刻意取本地日。把三個時區的實際輸出寫進報告，並確認差異只出現在
`startedDay`。

- [ ] **Step 6: Commit**

```bash
git add app/projects/timeline-model.ts tests/timeline-model.test.ts
git commit -m "feat: 魚骨圖排版純函式模組"
```

---

### Task 4: board 路由新增 `view`

**Files:**
- Modify: `app/projects/navigation.ts`
- Test: `tests/project-navigation.test.ts`

**Interfaces:**
- Produces: `ProjectRoute` 的 board 分支變成
  `{ kind: "board"; projectId: string; boardId: string; view: "board" | "timeline" }`

- [ ] **Step 1: 寫失敗測試**

`tests/project-navigation.test.ts` 加入：

```ts
test("parses a board route with the default view", () => {
  assert.deepEqual(parseProjectHash("#/projects/p1/boards/b1"), {
    kind: "board", projectId: "p1", boardId: "b1", view: "board",
  });
});

test("parses the timeline view of a board route", () => {
  assert.deepEqual(parseProjectHash("#/projects/p1/boards/b1/timeline"), {
    kind: "board", projectId: "p1", boardId: "b1", view: "timeline",
  });
});

test("rejects an unknown board sub-view", () => {
  assert.equal(parseProjectHash("#/projects/p1/boards/b1/nope"), null);
});

test("serializes both board views", () => {
  assert.equal(
    serializeProjectRoute({ kind: "board", projectId: "p1", boardId: "b1", view: "board" }),
    "#/projects/p1/boards/b1",
  );
  assert.equal(
    serializeProjectRoute({ kind: "board", projectId: "p1", boardId: "b1", view: "timeline" }),
    "#/projects/p1/boards/b1/timeline",
  );
});
```

`p1`／`b1` 請換成該檔既有測試使用的合法 resource id（`isServerResourceId` 會驗格式）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 4 "board route"`
Expected: FAIL——回傳物件沒有 `view`。

- [ ] **Step 3: 實作**

`ProjectRoute` 的 board 分支加 `view: "board" | "timeline"`。

`parseProjectHash` 現有的 4 段判斷（`segments.length === 4`）回傳 `view: "board"`；
另加 5 段判斷：`segments.length === 5 && segments[4] === "timeline"` 時回
`view: "timeline"`。其餘 5 段組合回 `null`（沿用既有「無法解析就 null」的行為）。

`serializeProjectRoute` 的 board 分支：

```ts
  const boardPath = `#/projects/${route.projectId}/boards/${route.boardId}`;
  return route.view === "timeline" ? `${boardPath}/timeline` : boardPath;
```

`resolveAuthorizedRoute`、`boardBelongsToRoute` 與 `saveActiveContext` **不需要改**——
它們只看 `projectId`／`boardId`。`pnpm typecheck` 會抓出所有需要補 `view` 的建構點。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全綠。此時 `view` 已解析但還沒有人使用，看板行為完全不變——這是預期的中間狀態。

- [ ] **Step 5: Commit**

```bash
git add app/projects/navigation.ts tests/project-navigation.test.ts
git commit -m "feat: board 路由支援 timeline 檢視"
```

---

### Task 5: `BoardTimeline` 元件與檢視切換

**Files:**
- Create: `app/components/board/BoardTimeline.tsx`
- Modify: `app/components/board/BoardApp.tsx`
- Modify: `app/components/projects/ProjectApp.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `timeline-model.ts` 全部 export、`Card`、`BoardState`。
- Produces:
  - `export function BoardTimeline(props: { board: BoardState; onOpenCard: (cardId: string) => void }): JSX.Element`
  - `BoardApp` 新增 prop `view?: "board" | "timeline"`（預設 `"board"`）

- [ ] **Step 1: 實作 BoardTimeline**

`app/components/board/BoardTimeline.tsx`。它**只吃 board 與一個開卡回呼**，不碰同步、
不碰 store——狀態與資料都由 `BoardApp` 持有。

- 自有狀態只有縮放級距（`useState<number>(DEFAULT_PX_PER_DAY)`）與全螢幕旗標。
- 用 `timelineBounds(cards, todayString())` 取範圍；回 `null` 時顯示
  「這張看板還沒有任務開工。卡片移出第一欄之後就會出現在時間軸上。」並仍列出未啟動池。
  `todayString` 從 `app/projects/calendar-model.ts` import（已 export）。
- `layoutTimeline` 的結果以 `useMemo` 快取，依賴 `[board.cards, bounds, pxPerDay]`——
  規格 §4.4 要求排版一次算完，不在渲染迴圈裡重算。
- 主骨為一條水平線，寬度 `dayOffset(from, to) * pxPerDay + TIMELINE_CARD_WIDTH`，
  外層容器 `overflow-x: auto`。日期刻度依 `pxPerDay` 決定間隔（`>= 24` 每日、`>= 12` 每三日、
  其餘每七日），避免刻度重疊。
- 每個節點絕對定位於 `left: node.x`，依 `side` 放在主骨上／下，`row` 決定離主骨的距離。
- 子卡以虛線連到父卡（父卡在同側，畫一條 SVG 或 CSS 斜線即可）；父卡未開工時該子卡改為
  實線直接接主骨。
- 卡面：標題、日期標籤（該卡的 `startedDay`）、checklist `3/6`（`checklist.length > 0` 才顯示）、
  受阻與加急以文字加樣式雙區隔。點卡片呼叫 `onOpenCard(cardId)`。
- 未啟動池固定在左端，列出 `unstartedCards(cards)`，每筆同樣可點開。
- `.timelineNarrowNotice` 恆在 DOM，由 CSS 在 899px 切換。

- [ ] **Step 2: 接進 BoardApp**

`BoardApp` 的 props 加 `view?: "board" | "timeline"`（預設 `"board"`）。把既有的
`<section className="board" aria-label="Kanban 看板">…</section>`（約 line 1016–1219）
包成條件渲染：

```tsx
      {view === "timeline" ? (
        <BoardTimeline board={board} onOpenCard={openEdit} />
      ) : (
        <section className="board" aria-label="Kanban 看板">
          {/* …既有欄位渲染完全不動… */}
        </section>
      )}
```

`openEdit` 是 `BoardApp` 既有的開卡函式（若實際名稱不同，用檔內實際的那個）。這樣魚骨圖
點卡片會開啟**同一個** `DetailModal`，唯讀與權限判斷全部沿用，不需要任何新程式。

檢視切換連結放在標頭區（`{navigation}` 附近），兩個 `<a href>` 指向
`#/projects/:pid/boards/:bid` 與 `…/timeline`，current 的那個加 `aria-current="page"`。
用連結而非按鈕，狀態才留在 URL、可分享可重載——與日曆及甘特圖的作法一致。

篩選、搜尋、統計列與 `DetailModal` 都在條件式之外，兩個檢視共用。

- [ ] **Step 3: 傳入 view**

`app/components/projects/ProjectApp.tsx`：`ProjectRouteView` 內把 `route.view` 一路傳到
`BoardApp` 的 `view` prop。`route.kind === "board"` 的既有判斷不變。

- [ ] **Step 4: CSS**

`app/globals.css` 比照日曆與甘特圖那兩段新增 `.timelineShell`、`.timelineScroll`、
`.timelineSpine`、`.timelineTick`、`.timelineNode`、`.timelineCard`（`.blocked`／`.expedite`
變體沿用 `.card` 既有語彙）、`.timelineLink`、`.timelineUnstarted`、`.timelineZoom`、
`.timelineNarrowNotice`。斷點與既有兩個檢視一致：

```css
@media (max-width: 899px) {
  .timelineScroll { display: none; }
  .timelineNarrowNotice { display: block; }
}
```

- [ ] **Step 5: 驗證**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠。

React 元件沒有測試 harness，**必須自己看**。`pnpm dev` 目前無法啟動（釘死的 miniflare
只支援到 compat date 2026-05-22，專案設 2026-08-07，屬既有問題），所以請用 esbuild 或純
Vite 掛載**未修改的正式元件**配 stub 資料在瀏覽器實測，並逐項記錄觀察：卡片位置與日期刻度
相符、子卡與父卡同側且虛線連對、同日多卡分列不重疊、未啟動池有內容、五個縮放級距切換後
位置仍正確、899px 與 900px 兩側的斷點行為、點卡片會開啟 `DetailModal`。

- [ ] **Step 6: Commit**

```bash
git add app/components/board/BoardTimeline.tsx app/components/board/BoardApp.tsx app/components/projects/ProjectApp.tsx app/globals.css
git commit -m "feat: 看板時間軸魚骨圖檢視"
```

---

### Task 6: 卡片面板的「上層任務」選單

**Files:**
- Modify: `app/components/board/DetailModal.tsx`
- Modify: `app/components/board/BoardApp.tsx`（把候選清單傳進 `DetailModal`）
- Modify: `app/globals.css`
- Test: `tests/board-draft.test.ts`

**Interfaces:**
- Consumes: `eligibleParentCards`（`app/board-model.ts`）、`CardDraft.parentCardId`。
- Produces: 卡片面板可設定上層任務；選項已排除不合法目標。

- [ ] **Step 1: 寫失敗測試**

`tests/board-draft.test.ts` 加入（測 draft 層，不測 React）：

```ts
test("draftFromCard and draftToCardInput round-trip parentCardId", () => {
  const board = createDemoBoard();
  const [parentId, childId] = Object.keys(board.cards);
  const linked = updateCard(board, childId, { parentCardId: parentId });
  const draft = draftFromCard(linked.cards[childId]);
  assert.equal(draft.parentCardId, parentId);
  assert.equal(draftToCardInput(draft).parentCardId, parentId);
});

test("createDraft starts with no parent", () => {
  assert.equal(createDraft().parentCardId, null);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 3 "parentCardId"`
Expected: FAIL 或（若 Task 1 已讓它通過）改為斷言 `createDraft` 的預設值那條先紅。

- [ ] **Step 3: 實作 UI**

`DetailModal` 新增 prop `parentOptions: Array<{ cardId: string; label: string }>`。
在「投入期間」fieldset 之後新增一個 `<label>`「上層任務」，內容是 `<select>`：

- 第一個選項 `<option value="">（直接掛在時間軸上）</option>`
- 其餘來自 `parentOptions`
- `readOnly` 為 true 時 `disabled`（整卡唯讀）；**不**受 `canManageAssignments` 影響——
  上層任務是工作內容的組織方式，member 可改
- 下方 `<small className="fieldHint">` 說明：「上層任務只表示工作的歸屬，不影響完成狀態。」

`BoardApp` 計算 `parentOptions`：新增模式（尚無 cardId）時列出全部卡片；編輯模式時用
`eligibleParentCards(board.cards, detail.cardId)`。label 取卡片標題，**同標題時附短 id
區分**（`${title}（${cardId.slice(-6)}）`），比照 `CardItem.tsx` 既有的短 id 呈現慣例。

- [ ] **Step 4: CSS**

`app/globals.css` 新增 `.parentTaskField`，沿用既有 `.fieldGroup`／`.fieldHint` 語彙。

- [ ] **Step 5: 驗證**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠。

另用 Task 5 那套 harness 手動確認：選單不含自己、不含自己的子孫、不含會超過深度上限的卡片；
選了上層任務後存檔、重開卡片仍保留；member 角色下這個欄位**可用**（與指派區的唯讀相對照）。
把觀察寫進報告。

- [ ] **Step 6: Commit**

```bash
git add app/components/board app/globals.css tests/board-draft.test.ts
git commit -m "feat: 卡片面板設定上層任務"
```

---

### Task 7: 文件與完整品質關卡

**Files:**
- Modify: `README.md`
- Modify: `NextTasks.md`

- [ ] **Step 1: README**

「功能」清單新增：

```markdown
- 看板時間軸魚骨圖：任務以實際開工日從時間軸長出、子任務連到上層任務（桌面專用）。
```

「Project／Board 與同步行為」新增三行：

```markdown
- 卡片可設定「上層任務」形成最多三層的結構分解；這只表示工作歸屬，**不影響**完成狀態、
  WIP 計算、老化或任何流動度量。子任務沒完成，父任務也可能已達成目標。
- 刪除父卡不會刪除子卡：子卡的上層任務關聯被清空，升為頂層。
- 上層任務關聯隨卡片整體 LWW 合併；合併後一律重新正規化，因此跨裝置編輯不會產生循環。
```

「相關文件」新增規格與計畫兩個連結。

- [ ] **Step 2: NextTasks 狀態表**

新增一列（`| 看板時間軸魚骨圖 v1 | 已實作，待 staging 部署與驗收 | …`），內容涵蓋：
schema v9 的 `parentCardId` 與 `MAX_CARD_DEPTH = 3`；父子不影響狀態；四種壞連結的正規化；
刪父卡子卡升頂層；Worker `requireValidCardHierarchy`（缺席即通過、三個呼叫點）；
`parentCardId` 不在 `assignmentSignature` 內、member 可改；路由
`#/projects/:pid/boards/:bid/timeline`；接點取 `startedAt` 且以本地時區取日；
未啟動池；桌面專用；**無 D1 migration、無新 Worker 端點、無權限放寬**。

- [ ] **Step 3: NextTasks 驗收清單**

在 P0-4 新增「看板時間軸魚骨圖」小節，逐條抄規格 §8 的 14 項驗收條件為 `- [ ]`。

- [ ] **Step 4: NextTasks P1 記錄本次的已知落差**

至少記入這兩項（實作過程若另有發現，一併判斷輕重後加入，並在報告說明取捨）：

- 接點取 `startedAt`，語意是「卡片首次離開第一欄」。若團隊習慣是卡片建立後很久才移動，
  魚骨圖上的啟動時點會比真實開工晚。這是既有欄位語意，非本功能缺陷。
- `normalizeCardHierarchy` 的深度修正以字典序走訪，超長鏈被截斷的是「排序在前」的那張卡，
  而非最深的那張。結果決定且幂等，但不一定符合直覺；若日後要改成「從最深處截斷」，
  需同時更新 `assertBoardInvariants` 的測試。

- [ ] **Step 5: 九項品質關卡**

逐一執行並記錄實際輸出（不是「應該會過」）：

```bash
pnpm test
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
pnpm worker:types:check
pnpm sync:dry-run:staging
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add README.md NextTasks.md
git commit -m "docs: 記錄看板時間軸魚骨圖 v1"
```

---

## 部署備註

本功能**沒有 D1 migration、沒有新 Worker 端點、沒有權限放寬**，但有 schema 版本升級，
部署順序不可顛倒：

1. 先 `pnpm sync:deploy:staging`——Worker 必須先能接受並驗證 `parentCardId`，否則 v9
   客戶端送上來的新欄位會被舊 Worker 原樣存入而未經驗證。
2. 再 `pnpm web:deploy:beta`。
3. 部署後確認：舊看板的 member 編輯仍得 200（lockout 回歸的線上確認）；member 改上層任務
   得 200；member 改指派仍得 403。

**混版風險**：v8 及更早的客戶端送出的 board 不含 `parentCardId`。由於這個欄位由 Worker
「缺席即通過」放行、且客戶端 `normalizeCards` 對缺席補 `null`，舊客戶端的編輯會把該看板
**全部的上層任務關聯清空**（與甘特圖 v8 的投入期間同型）。因此 Web Beta 發布後，
使用者裝置必須重新載入頁面；行動版須盡快跟上，在新版安裝前不要用舊 App 編輯卡片。
