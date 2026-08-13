# 人力甘特圖 v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓管理者在一張以人為列、以日期為軸的甘特圖上看出誰有空檔、誰被排爆。

**Architecture:** Card schema 升到 v8，新增 `assignmentWindows`（每位指派人一段投入期間）。
Worker 端以簽章比對把指派與期間的變更權限收斂到 Project owner，並新增
`GET /assignments` 以雙層 `json_each` 在 SQL 層展開卡片與期間。前端新增純函式模組
`resource-model.ts` 承載全部排版計算，`ResourceView` 只負責繪製。

**Tech Stack:** TypeScript、React（vinext / Vite）、Cloudflare Workers、D1（SQLite JSON1）、
node:test（前端）、Vitest + Cloudflare Workers pool（Worker runtime tests）。

**規格：** `docs/superpowers/specs/2026-08-13-resource-gantt-design.md`

## Global Constraints

- 所有使用者可見文案為繁體中文。
- 桌面專用：`< 900px` 顯示引導訊息而非破版時間軸；由 CSS 專責切換，通知元素恆在 DOM。
- 只有 Project owner（D1 `manager`）可變更 `assigneeUserIds` 與 `assignmentWindows`。
- **缺 `assignmentWindows` 不是錯誤**：Worker 對缺席欄位一律放行，否則舊看板的 member
  編輯會被 403 鎖死（流動度量 v7 的 absent-settings lockout 同型錯誤）。
- 日期一律 `YYYY-MM-DD` date-only 字串，`startDate <= endDate`，含頭尾。
- 端點回應不得含描述、checklist、附件與阻塞原因。
- 403／404 語意：無權限 403；不可見資源 404，不洩漏存在性。
- 每卡 window 上限 20（對齊 `MAX_ASSIGNEES_PER_CARD`）。
- D1 單一查詢 bind 參數上限 100：所有 `IN (...)` 清單分批，`CHUNK_SIZE = 50`。
- 三個截斷旗標都要有：`boardsTruncated`、`barsTruncated`、`unscheduledTruncated`。
- 阻塞、加急、過載一律文字加樣式雙區隔，不只靠顏色。

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| `app/board-model.ts` | 領域核心：`AssignmentWindow` 型別、`normalizeAssignmentWindows`、schema v8、addCard／updateCard 寫入路徑 |
| `app/components/board/shared.ts` | `CardDraft` 攜帶 windows 與 draft↔card 轉換 |
| `app/components/board/DetailModal.tsx` | 每位指派人的起訖日輸入；非 owner 唯讀 |
| `app/projects/navigation.ts` | `resources` 路由、管理者檢視可見性判斷、`BoardAccess.canManageAssignments` |
| `app/projects/types.ts` | `ResourceData` 等 client 型別 |
| `app/projects/api.ts` | `getAssignments` 與嚴格 response parser |
| `app/projects/resource-model.ts` | **新增**：日期軸、lane packing、過載計算、視窗位移、跨窗裁切 |
| `app/components/projects/ResourceView.tsx` | **新增**：甘特圖繪製 |
| `app/components/projects/WorkspaceEntryNav.tsx` | 導覽新增甘特圖入口 |
| `app/components/projects/ProjectApp.tsx` | 路由分支與 props 串接 |
| `app/globals.css` | 甘特圖樣式與 899px 斷點 |
| `worker-sync/src/boards.ts` | window 結構驗證、`assignmentSignature` owner-only 強制 |
| `worker-sync/src/board-diff.ts` | Activity Log 新增 `assignmentWindows` 欄位 |
| `worker-sync/src/assignments.ts` | **新增**：`GET /assignments` 範圍、查詢與回應 |
| `worker-sync/src/router.ts` | 註冊端點 |

---

### Task 1: Card schema v8 型別、normalize 與 draft 轉換

**Files:**
- Modify: `app/board-model.ts`（`BOARD_SCHEMA_VERSION`、`Card`、`normalizeCards`、`addCard`、`updateCard`、`parsePersistedBoard`）
- Modify: `app/components/board/shared.ts:16-140`（`CardDraft`、`createDraft`、`draftFromCard`、`draftToCardInput`）
- Test: `tests/board-assignment-windows.test.ts`（新增）

**Interfaces:**
- Consumes: 現有 `normalizeDateOnly`、`uniqueStrings`、`normalizeTimestamp`（皆在 `app/board-model.ts` 內，非 export）。
- Produces:
  - `export type AssignmentWindow = { userId: string; startDate: string; endDate: string }`
  - `export const MAX_ASSIGNMENT_WINDOWS_PER_CARD = 20`
  - `export function normalizeAssignmentWindows(value: unknown, assigneeUserIds: string[]): AssignmentWindow[]`
  - `Card.assignmentWindows: AssignmentWindow[]`
  - `BOARD_SCHEMA_VERSION = 8`
  - `CardDraft.assignmentWindows: AssignmentWindow[]`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/board-assignment-windows.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  addCard,
  createDemoBoard,
  normalizeAssignmentWindows,
  normalizeBoard,
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 3 "board-assignment-windows"`
Expected: FAIL，`normalizeAssignmentWindows` 不存在、`BOARD_SCHEMA_VERSION` 是 7。

- [ ] **Step 3: 加型別與 normalize 函式**

在 `app/board-model.ts` 頂端把版本改為 8：

```ts
export const BOARD_SCHEMA_VERSION = 8;
```

在 `Card` 型別（約 line 39）的 `serviceClass` 之後加欄位，並在 `ServiceClass` 相關型別附近新增
`AssignmentWindow`：

```ts
/** 某位指派人在這張卡上的計畫投入期間；date-only，含頭尾。 */
export type AssignmentWindow = {
  userId: string;
  startDate: string;
  endDate: string;
};

export const MAX_ASSIGNMENT_WINDOWS_PER_CARD = 20;
```

`Card` 新增：

```ts
  /** 每位指派人各自的計畫投入期間；缺項＝該指派尚未排期，不是錯誤。 */
  assignmentWindows: AssignmentWindow[];
```

在 `normalizeDateOnly`（約 line 1286）附近新增：

```ts
/** 只保留 userId 在指派名單內、兩個日期都合法且不反向的 window；同一 userId 取第一筆，
 *  並依 userId 排序成 canonical 形式，使 normalizeBoard 幂等、Worker 簽章穩定。 */
export function normalizeAssignmentWindows(
  value: unknown,
  assigneeUserIds: string[],
): AssignmentWindow[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(assigneeUserIds);
  const seen = new Set<string>();
  const windows: AssignmentWindow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { userId?: unknown; startDate?: unknown; endDate?: unknown };
    if (typeof entry.userId !== "string" || !allowed.has(entry.userId)) continue;
    if (seen.has(entry.userId)) continue;
    const startDate = normalizeDateOnly(entry.startDate);
    const endDate = normalizeDateOnly(entry.endDate);
    if (!startDate || !endDate || endDate < startDate) continue;
    seen.add(entry.userId);
    windows.push({ userId: entry.userId, startDate, endDate });
    if (windows.length >= MAX_ASSIGNMENT_WINDOWS_PER_CARD) break;
  }
  return windows.sort((left, right) => left.userId.localeCompare(right.userId));
}
```

- [ ] **Step 4: 接上三個寫入路徑**

`normalizeCards`（約 line 1180）：把 assignee 清單提前算出來再共用。

```ts
    const assigneeUserIds = uniqueStrings(
      Array.isArray((raw as { assigneeUserIds?: unknown }).assigneeUserIds)
        ? (raw as { assigneeUserIds: string[] }).assigneeUserIds
        : [],
    );
    normalized[cardId] = {
      // …既有欄位不變，把原本的 assigneeUserIds: uniqueStrings(...) 換成：
      assigneeUserIds,
      // …serviceClass 之後新增：
      assignmentWindows: normalizeAssignmentWindows(
        (raw as { assignmentWindows?: unknown }).assignmentWindows,
        assigneeUserIds,
      ),
    };
```

`addCard`（約 line 404）：同樣提前算 assignee 清單。

```ts
  const assigneeUserIds = uniqueStrings(input.assigneeUserIds ?? []);
  const card: Card = {
    // …把原本的 assigneeUserIds: uniqueStrings(input.assigneeUserIds ?? []) 換成 assigneeUserIds,
    // …serviceClass 之後新增：
    assignmentWindows: normalizeAssignmentWindows(input.assignmentWindows, assigneeUserIds),
  };
```

`updateCard`（約 line 480）：window 必須依「更新後」的指派名單重新過濾，移除指派人時他的
期間要一併消失。

```ts
  const assigneeUserIds = uniqueStrings(patch.assigneeUserIds ?? existing.assigneeUserIds);
  next.cards[cardId] = {
    ...existing,
    ...patch,
    // …把原本的 assigneeUserIds: uniqueStrings(...) 換成 assigneeUserIds,
    assignmentWindows: normalizeAssignmentWindows(
      patch.assignmentWindows ?? existing.assignmentWindows,
      assigneeUserIds,
    ),
    // …其餘欄位不變
  };
```

`parsePersistedBoard`（約 line 800）的版本白名單加入 7：

```ts
        version !== 6 &&
        version !== 7 &&
        version !== BOARD_SCHEMA_VERSION)
```

- [ ] **Step 5: 更新 draft 轉換**

`app/components/board/shared.ts`：`CardDraft` 在 `serviceClass` 之後加
`assignmentWindows: AssignmentWindow[];`（從 `../../board-model` import 型別），
`createDraft` 回 `assignmentWindows: []`，`draftFromCard` 回
`assignmentWindows: card.assignmentWindows.map((entry) => ({ ...entry }))`，
`draftToCardInput` 回：

```ts
    assignmentWindows: draft.assignmentWindows.filter((entry) =>
      draft.assigneeUserIds.includes(entry.userId),
    ),
```

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm test`
Expected: PASS，包含新檔全部測試；既有 `board-model.test.ts`、`board-flow-metrics.test.ts`、
`board-draft.test.ts` 仍全綠。若既有測試因 schema 版本斷言而失敗，更新該斷言而非改回版本。

- [ ] **Step 7: typecheck 與 lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 皆無輸出。任何 `assignmentWindows` 缺欄位的型別錯誤都必須補齊，不得用 `as any`。

- [ ] **Step 8: Commit**

```bash
git add app/board-model.ts app/components/board/shared.ts tests/board-assignment-windows.test.ts
git commit -m "feat: card schema v8 加入每人投入期間"
```

---

### Task 2: Worker 驗證與 owner-only 指派權限

**Files:**
- Modify: `worker-sync/src/boards.ts`（新增 `requireValidAssignmentWindows`、`assignmentSignature`、`requireAssignmentManagement`，並在 `putBoardContent` 呼叫）
- Modify: `worker-sync/src/board-diff.ts:20-60,225-240`（`CardField`、`CardSnapshot`、diff 判斷）
- Test: `worker-sync/test/boards.integration.test.ts`

**Interfaces:**
- Consumes: 既有 `asRecord`、`parseUuid`、`RequestError`、`ProjectAccess`、`requireWorkflowManagement` 的呼叫位置（`worker-sync/src/boards.ts:707`）。
- Produces: Worker 對 `assignmentWindows` 的結構驗證與 403 強制；Activity Log 可記
  `assignmentWindows` 欄位變更。

- [ ] **Step 1: 寫失敗測試**

在 `worker-sync/test/boards.integration.test.ts` 末端加入。**先讀完該檔的 fixture 區**，沿用它
既有的 workspace／project／board／member／token 建立方式與 `SELF.fetch` 慣例。下列測試碼中的
`putContent(token, baseRevision, board)`、`boardWithCard(cardPatch)`、
`boardWithoutWindowsKey(cardPatch)`、`seedBoardData(board)`、`readBoardLog(token)`、
`ownerToken`、`memberToken`、`CARD_ID`、`currentRevision` 都是**佔位名稱**，代表「該檔已經有
或你需要就地補上的最小輔助」。實作時一律換成檔內實際的名稱與呼叫方式；若某個輔助不存在，
就用該檔既有風格補一個最小版本，不要另建新的 fixture 體系。

```ts
const ALICE = "11111111-2222-4333-8444-555555555555";

it("rejects malformed assignment windows with 400", async () => {
  const board = boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-8-7", endDate: "2026-08-13" }],
  });
  const response = await putContent(ownerToken, 1, board);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_assignment_windows");
});

it("rejects a window whose userId is not assigned", async () => {
  const board = boardWithCard({
    assigneeUserIds: [],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
  });
  const response = await putContent(ownerToken, 1, board);
  expect(response.status).toBe(400);
});

it("rejects a reversed window", async () => {
  const board = boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-13", endDate: "2026-08-07" }],
  });
  expect((await putContent(ownerToken, 1, board)).status).toBe(400);
});

it("rejects duplicate windows for the same user", async () => {
  const board = boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" },
      { userId: ALICE, startDate: "2026-08-09", endDate: "2026-08-10" },
    ],
  });
  expect((await putContent(ownerToken, 1, board)).status).toBe(400);
});

it("lets the project owner set assignments and windows", async () => {
  const board = boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
  });
  expect((await putContent(ownerToken, 1, board)).status).toBe(200);
});

it("forbids a member from changing assignees", async () => {
  const board = boardWithCard({ assigneeUserIds: [ALICE], assignmentWindows: [] });
  const response = await putContent(memberToken, 1, board);
  expect(response.status).toBe(403);
});

it("forbids a member from changing assignment windows", async () => {
  // owner 先建立含指派與期間的版本
  await putContent(ownerToken, 1, boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
  }));
  const response = await putContent(memberToken, 2, boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-20" }],
  }));
  expect(response.status).toBe(403);
});

it("lets a member edit other card fields while assignments stay identical", async () => {
  await putContent(ownerToken, 1, boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
  }));
  const response = await putContent(memberToken, 2, boardWithCard({
    title: "改過的標題",
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
  }));
  expect(response.status).toBe(200);
});

it("lets a member edit a legacy board that has no assignmentWindows key", async () => {
  // 直接寫入沒有 assignmentWindows 鍵的 board（模擬功能上線前的資料）
  await seedBoardData(boardWithoutWindowsKey({ assigneeUserIds: [ALICE] }));
  const next = boardWithCard({ title: "member 編輯", assigneeUserIds: [ALICE] });
  delete (next.cards[CARD_ID] as Record<string, unknown>).assignmentWindows;
  const response = await putContent(memberToken, currentRevision, next);
  expect(response.status).toBe(200);
});

it("treats an absent key and an empty array as the same signature", async () => {
  await seedBoardData(boardWithoutWindowsKey({ assigneeUserIds: [ALICE] }));
  const next = boardWithCard({ assigneeUserIds: [ALICE], assignmentWindows: [] });
  const response = await putContent(memberToken, currentRevision, next);
  expect(response.status).toBe(200);
});

it("records assignmentWindows as a changed field in the activity log", async () => {
  await putContent(ownerToken, 1, boardWithCard({
    assigneeUserIds: [ALICE],
    assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
  }));
  const logs = await readBoardLog(ownerToken);
  const entry = logs.find((row) => row.action === "card.updated" || row.action === "card.created");
  expect(JSON.stringify(entry)).toContain("assignmentWindows");
  expect(JSON.stringify(entry)).not.toContain("2026-08-07");
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm worker:test 2>&1 | tail -30`
Expected: FAIL——400 測試得到 200，403 測試得到 200。

- [ ] **Step 3: 加結構驗證**

`worker-sync/src/boards.ts`：在 `requireValidFlowFields`（line 79）之後新增。缺席即通過是刻意的。

```ts
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** v7 舊 client 相容：`assignmentWindows` 缺席即通過，出現才驗格式。
 *  絕不能要求「每位指派人都要有 window」——那會讓舊卡的任何編輯都 400。 */
function requireValidAssignmentWindows(value: unknown): void {
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return;
  for (const raw of Object.values(cards)) {
    const card = asRecord(raw);
    if (!card || card.assignmentWindows === undefined) continue;
    const windows = card.assignmentWindows;
    if (!Array.isArray(windows) || windows.length > MAX_ASSIGNEES_PER_CARD) {
      throw new RequestError(400, "invalid_assignment_windows");
    }
    const assigned = new Set(
      Array.isArray(card.assigneeUserIds)
        ? card.assigneeUserIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    const seen = new Set<string>();
    for (const entry of windows) {
      const window = asRecord(entry);
      if (!window) throw new RequestError(400, "invalid_assignment_windows");
      const userId = typeof window.userId === "string" ? window.userId : "";
      const startDate = window.startDate;
      const endDate = window.endDate;
      if (
        !userId ||
        !assigned.has(userId) ||
        seen.has(userId) ||
        typeof startDate !== "string" || !DATE_ONLY.test(startDate) ||
        typeof endDate !== "string" || !DATE_ONLY.test(endDate) ||
        endDate < startDate
      ) {
        throw new RequestError(400, "invalid_assignment_windows");
      }
      seen.add(userId);
    }
  }
}
```

- [ ] **Step 4: 加簽章與 owner-only 強制**

在 `requireWorkflowManagement`（line 157）之後新增。**排序是必要的**：客戶端送來的卡片順序與
陣列順序不保證穩定，未排序會讓等價內容算出不同簽章而誤 403。

```ts
/** 缺席的 assignmentWindows 與空陣列必須算出同一個簽章，否則 v8 client 一律送空陣列、
 *  舊 board 沒有此鍵，member 對舊 board 的任何編輯都會被誤判為「變更了指派」而 403。
 *  這是流動度量 v7 absent-settings lockout 的同型錯誤，不接受第二次。 */
function assignmentSignature(value: unknown): string {
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return "[]";
  const entries = Object.entries(cards).map(([cardId, raw]) => {
    const card = asRecord(raw);
    const assignees = Array.isArray(card?.assigneeUserIds)
      ? [...card!.assigneeUserIds]
        .filter((id): id is string => typeof id === "string")
        .sort()
      : [];
    const windows = Array.isArray(card?.assignmentWindows)
      ? card!.assignmentWindows
        .map((entry) => {
          const window = asRecord(entry);
          return window
            ? [window.userId, window.startDate, window.endDate]
            : null;
        })
        .filter((window): window is unknown[] => window !== null)
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      : [];
    return [cardId, assignees, windows];
  });
  entries.sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return JSON.stringify(entries);
}

function requireAssignmentManagement(
  access: ProjectAccess,
  previousBoard: unknown,
  nextBoard: unknown,
): void {
  if (access.projectRole === "manager") return;
  if (assignmentSignature(previousBoard) !== assignmentSignature(nextBoard)) {
    throw new RequestError(403, "forbidden");
  }
}
```

在 `putBoardContent`（line 704-707 附近）接上，順序為驗結構 → 驗權限：

```ts
  requireValidFlowFields(payload.board);
  requireValidAssignmentWindows(payload.board);
  const previousBoard = JSON.parse(row.data) as unknown;
  const effectiveBoard = preserveBoardSettings(previousBoard, payload.board);
  requireWorkflowManagement(access, previousBoard, effectiveBoard);
  requireAssignmentManagement(access, previousBoard, effectiveBoard);
```

`putLegacyRow`（line 798 附近）只加結構驗證，legacy 路徑沒有 project role：

```ts
  requireValidFlowFields(payload.board);
  requireValidAssignmentWindows(payload.board);
```

- [ ] **Step 5: Activity Log 欄位**

`worker-sync/src/board-diff.ts`：`CardField` union 加 `| "assignmentWindows"`；`CardSnapshot`
加 `assignmentWindows: unknown[];`；snapshot 建構處（約 line 176）加
`assignmentWindows: safeArray(card.assignmentWindows),`；diff 比較處（約 line 230）加：

```ts
  if (!sameValue(before.assignmentWindows, after.assignmentWindows)) {
    fields.push("assignmentWindows");
  }
```

只記欄位名稱，不記日期內容——沿用 `blockedReason` 的既有原則。

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm worker:test`
Expected: PASS，全部既有 Worker 測試維持綠燈。

- [ ] **Step 7: Mutation 驗證兩條防線**

把 `assignmentSignature` 開頭的 `if (!cards) return "[]"` 改成 `return JSON.stringify(cards)`，
確認「member 編輯舊 board」測試會失敗；復原。
再把 `entries.sort(...)` 註解掉，確認等價內容仍通過（若無測試捕捉，補一個卡片順序顛倒但內容
相同的 member 編輯測試，斷言 200）；復原。

Run: `pnpm worker:test`
Expected: 復原後全綠，且上述兩次 mutation 各有測試轉紅。

- [ ] **Step 8: Commit**

```bash
git add worker-sync/src/boards.ts worker-sync/src/board-diff.ts worker-sync/test/boards.integration.test.ts
git commit -m "feat: Worker 驗證投入期間並將指派權限收斂到 owner"
```

---

### Task 3: `GET /assignments` 端點

**Files:**
- Create: `worker-sync/src/assignments.ts`
- Modify: `worker-sync/src/router.ts:1-30`
- Test: `worker-sync/test/assignments.integration.test.ts`（新增）

**Interfaces:**
- Consumes: `resolveCalendarScope`（`worker-sync/src/calendar.ts`，已 export）、`ApiContext`、
  `requireMigrationComplete`、`json`、`RequestError`、`parseUuid`。
- Produces: `export async function handleAssignmentsRequest(context: ApiContext): Promise<Response | null>`

- [ ] **Step 1: 先用實測確認雙層 json_each 的行為**

這一步不可跳過。`json_each` 的參數在 WHERE 之前就會對每一列求值，因此外層的
`cards.type = 'object'` **救不了**內層的 `json_extract(cards.value, '$.assignmentWindows')`——
卡片是 scalar 時內層會在展開階段直接拋 `malformed JSON`，讓整個查詢 500。

建立臨時腳本 `/tmp/probe.mjs` 實測（node:sqlite 與 D1 的 SQLite 行為一致）：

```js
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE b (data TEXT)");
db.exec(`INSERT INTO b VALUES ('{"cards":{"ok":{"assignmentWindows":[{"userId":"u","startDate":"2026-08-07","endDate":"2026-08-08"}]},"bad":"scalar"}}')`);
const naive = `SELECT cards.key FROM b
  JOIN json_each(json_extract(b.data,'$.cards')) AS cards
  JOIN json_each(json_extract(cards.value,'$.assignmentWindows')) AS w
  WHERE cards.type='object' AND w.type='object'`;
const guarded = `SELECT cards.key FROM b
  JOIN json_each(json_extract(b.data,'$.cards')) AS cards
  JOIN json_each(CASE WHEN cards.type='object'
        THEN json_extract(cards.value,'$.assignmentWindows') END) AS w
  WHERE w.type='object'`;
for (const [name, sql] of [["naive", naive], ["guarded", guarded]]) {
  try { console.log(name, db.prepare(sql).all()); }
  catch (error) { console.log(name, "THREW", error.message); }
}
```

Run: `node /tmp/probe.mjs`
Expected: `naive THREW malformed JSON`；`guarded [ { key: 'ok' } ]`。
若實測結果與此不同，以實測為準並在 Task 報告中說明，不要照抄本計畫的 SQL。

- [ ] **Step 2: 寫失敗測試**

建立 `worker-sync/test/assignments.integration.test.ts`。fixture 建構請直接複製
`worker-sync/test/calendar.integration.test.ts` 的 helper（workspace／project／board／member／
token 建立與 seed board 的寫法），只改資料內容。

先寫這一個完整案例作為其餘案例的模板（`seedBoard`／`adminToken` 換成 calendar 測試檔內的實際
名稱）：

```ts
it("returns one bar per assignee window that overlaps the range", async () => {
  await seedBoard({
    version: 8,
    cards: {
      c1: {
        id: "c1",
        title: "共同任務",
        completedAt: null,
        blocked: false,
        serviceClass: "standard",
        assigneeUserIds: [ALICE, BOB],
        assignmentWindows: [
          { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
          { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-12" },
        ],
      },
    },
    columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["c1"] }],
  });

  const response = await SELF.fetch(
    `https://example.com/assignments?workspaceId=${WORKSPACE_ID}&from=2026-08-07&to=2026-08-17`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.scope).toBe("workspace");
  expect(body.bars).toHaveLength(2);
  expect(body.bars.map((bar) => [bar.userId, bar.startDate, bar.endDate]).sort())
    .toEqual([
      [ALICE, "2026-08-07", "2026-08-13"],
      [BOB, "2026-08-07", "2026-08-12"],
    ].sort());
  expect(body.bars.every((bar) => bar.title === "共同任務")).toBe(true);
  expect(body.unscheduled).toHaveLength(0);
  expect(body.barsTruncated).toBe(false);
});
```

其餘必要案例（fixture 與斷言依上例的形狀寫齊）：

```ts
it("returns 401 without a token", async () => { /* GET /assignments 無 Authorization → 401 */ });
it("returns 400 for a malformed range", async () => {
  // from/to 格式錯、from > to、窗長 32 天（含頭尾）→ 400 invalid_range
});
it("accepts a 31-day window inclusive of both ends", async () => {
  // 2026-08-01 ~ 2026-08-31 → 200
});
it("gives a workspace admin every active project in the workspace", async () => { /* scope: "workspace" */ });
it("gives a project owner only the projects they own", async () => { /* scope: "owned_projects" */ });
it("returns 403 for a member and 404 for a non-workspace user", async () => {});
it("returns one bar per assignee window that overlaps the range", async () => {
  // 卡片有 ALICE 8/07–8/13 與 BOB 8/07–8/12 兩個 window，查詢 8/07–8/17
  // → 兩筆 bars，各自帶 userId 與自己的起訖
});
it("excludes windows entirely outside the range", async () => {
  // window 8/01–8/05，查詢 8/07–8/17 → 0 筆
});
it("includes windows that straddle the range boundary", async () => {
  // window 8/05–8/09 與 8/15–8/20，查詢 8/07–8/17 → 兩筆都在
});
it("excludes completed cards, archived boards and archived projects", async () => {});
it("lists assignees without a window as unscheduled", async () => {
  // 卡片指派 ALICE 但 assignmentWindows 為空 → unscheduled 一筆，bars 0 筆
});
it("omits cards with no assignees entirely", async () => {
  // 無指派人的卡片既不在 bars 也不在 unscheduled
});
it("lists project members who have no bars in the range", async () => {
  // people 含完全沒有條子的成員
});
it("keeps a departed assignee in people, ordered after current members", async () => {
  // 從 project_members 移除 ALICE 但卡片仍指派他 → people 仍含 ALICE，且排在正式成員之後
});
it("survives a scalar card member", async () => {
  // $.cards 含 {"bad": "scalar"} → 200，只回正常卡片
});
it("survives a scalar assignmentWindows member", async () => {
  // assignmentWindows: [{...valid}, "scalar"] → 200，只回合法 window
});
it("survives a scalar assignmentWindows value", async () => {
  // assignmentWindows: "scalar" → 200，該卡不出現，其他卡正常
});
it("flags truncation for boards, bars and unscheduled", async () => {
  // 51 個 active 看板 → boardsTruncated；2001 筆 bars → barsTruncated；201 筆 → unscheduledTruncated
});
it("never leaks description, checklist, attachments or blocked reason", async () => {
  // 卡片各欄位塞 SECRET_MARKER，回應全文不得包含它
});
it("matches an independent JS filter over the same fixture", async () => {
  // 用 JS 對同一份 board JSON 過濾一次，與端點結果比對
});
it("works with more than 99 projects (bind chunking)", async () => {
  // 建立 101 個 active 專案 → 200，不得出現 D1_ERROR
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `pnpm worker:test 2>&1 | tail -20`
Expected: FAIL——`/assignments` 未註冊，全數 404。

- [ ] **Step 4: 實作端點**

建立 `worker-sync/src/assignments.ts`：

```ts
import { resolveCalendarScope } from "./calendar";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

/** 單次請求最多展開的看板數；超出時回應標記 boardsTruncated。 */
const MAX_BOARDS = 50;
/** 甘特條上限；超出時回應標記 barsTruncated。 */
const MAX_BARS = 2000;
/** 未排期清單上限；超出時回應標記 unscheduledTruncated。 */
const MAX_UNSCHEDULED = 200;
/** D1 單一查詢的 bind 參數上限是 100，所有 IN 清單都以此分批。 */
const CHUNK_SIZE = 50;
/** 查詢窗長上限，含頭尾。 */
const MAX_RANGE_DAYS = 31;

const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** 含頭尾的天數；輸入已由 DATE_ONLY 驗過格式。 */
function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}
```

查詢建構——**內層 json_each 必須用 CASE 包住**，理由見 Step 1：

```ts
function barQuery(projectPlaceholders: string): string {
  return `SELECT projects.id AS project_id, projects.name AS project_name,
                 boards.id AS board_id, boards.name AS board_name,
                 cards.key AS card_id,
                 json_extract(cards.value, '$.title') AS title,
                 json_extract(cards.value, '$.blocked') AS blocked,
                 json_extract(cards.value, '$.serviceClass') AS service_class,
                 json_extract(windows.value, '$.userId') AS user_id,
                 json_extract(windows.value, '$.startDate') AS start_date,
                 json_extract(windows.value, '$.endDate') AS end_date
          FROM boards
          INNER JOIN projects ON projects.id = boards.project_id
          JOIN json_each(json_extract(boards.data, '$.cards')) AS cards
          JOIN json_each(CASE WHEN cards.type = 'object'
                THEN json_extract(cards.value, '$.assignmentWindows') END) AS windows
          WHERE boards.id IN (
                  SELECT boards.id FROM boards
                  WHERE boards.status = 'active'
                    AND boards.project_id IN (${projectPlaceholders})
                  ORDER BY boards.updated_at DESC, boards.id DESC
                  LIMIT ${MAX_BOARDS}
                )
            AND projects.status = 'active'
            AND windows.type = 'object'
            AND json_extract(cards.value, '$.completedAt') IS NULL
            AND json_extract(windows.value, '$.startDate') <= ?
            AND json_extract(windows.value, '$.endDate') >= ?
          LIMIT ${MAX_BARS + 1}`;
}
```

未排期查詢：有指派人、但該人沒有對應 window。SQL 只取出「卡片 × 指派人」，window 比對在
Worker 內做，避免第三層 json_each：

```ts
function assignedCardQuery(projectPlaceholders: string): string {
  return `SELECT projects.id AS project_id, projects.name AS project_name,
                 boards.id AS board_id, boards.name AS board_name,
                 cards.key AS card_id,
                 json_extract(cards.value, '$.title') AS title,
                 json_extract(cards.value, '$.assigneeUserIds') AS assignee_ids,
                 json_extract(cards.value, '$.assignmentWindows') AS windows_json
          FROM boards
          INNER JOIN projects ON projects.id = boards.project_id
          JOIN json_each(json_extract(boards.data, '$.cards')) AS cards
          WHERE boards.id IN (
                  SELECT boards.id FROM boards
                  WHERE boards.status = 'active'
                    AND boards.project_id IN (${projectPlaceholders})
                  ORDER BY boards.updated_at DESC, boards.id DESC
                  LIMIT ${MAX_BOARDS}
                )
            AND projects.status = 'active'
            AND cards.type = 'object'
            AND json_extract(cards.value, '$.completedAt') IS NULL
          LIMIT ${MAX_UNSCHEDULED * 10}`;
}
```

`windows_json` 解析必須容錯：`JSON.parse` 失敗或結果非陣列時視為「沒有任何 window」，
該卡的全部指派人都算未排期；陣列內非物件成員直接跳過。`assignee_ids` 同樣容錯，非陣列時
該卡不產生任何未排期項。

`LIMIT` 用 `MAX_UNSCHEDULED * 10 + 1`：一張卡可能有多位指派人卻只有少數缺期間，所以原始列數
必須大於未排期上限才夠篩。**若原始列數達到這個 LIMIT，`unscheduledTruncated` 一律為 true**
——此時無法確定有沒有漏掉未排期項，寧可明示截斷也不要靜默少報。

handler 主體：

```ts
export async function handleAssignmentsRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (url.pathname !== "/assignments") return null;
  if (context.request.method !== "GET") return null;
  await requireMigrationComplete(context.env.DB);

  const workspaceId = parseUuid(url.searchParams.get("workspaceId"), "workspace_id");
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || from > to) {
    throw new RequestError(400, "invalid_range");
  }
  if (inclusiveDays(from, to) > MAX_RANGE_DAYS) {
    throw new RequestError(400, "invalid_range");
  }

  const scope = await resolveCalendarScope(context.env.DB, context.user.id, workspaceId);
  // 空範圍要回 200 空結果，不能與 403/404 混淆。
  // …分批查詢 bars 與 assigned cards、合併、排序、截斷、組 people、回應
}
```

排序在 Worker 內做（因為結果來自多批查詢，不能倚賴 SQL 的跨批順序）：
`bars` 依 `startDate`、`projectName`（`localeCompare`）、`title`、`userId`；
`unscheduled` 依 `projectName`、`title`、`userId`。
截斷判斷在排序後：`barsTruncated = merged.length > MAX_BARS`，再 `slice(0, MAX_BARS)`。

`people` 組法：

```ts
// 1. 可見專案的全體成員（含 owner／member／viewer），分批查詢後去重
//    SELECT DISTINCT project_members.user_id AS user_id,
//                    user_accounts.display_name AS display_name
//    FROM project_members
//    INNER JOIN user_accounts ON user_accounts.id = project_members.user_id
//    WHERE project_members.project_id IN (…)
// 2. 依 displayName（localeCompare）再 userId 排序，得到 currentMembers
// 3. bars 與 unscheduled 內出現、但不在 currentMembers 的 userId＝已離開專案但指派仍保留者，
//    分批查 user_accounts 取名字（查不到留空字串），同樣排序後接在 currentMembers 之後
// 4. people = [...currentMembers, ...departed]
```

`boardsTruncated`：分批查 `SELECT COUNT(*) FROM boards WHERE status='active' AND project_id IN (…)`
後相加，大於 `MAX_BOARDS` 即為 true。

回應欄位與型別完全比照規格 §4，另含 `requestId`。

- [ ] **Step 5: 註冊路由**

`worker-sync/src/router.ts`：import `handleAssignmentsRequest`，在 calendar 那一列（line 24）
旁邊加入同樣的 `{ capability: "authenticated", handle: handleAssignmentsRequest }`。

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm worker:test`
Expected: PASS，新檔全部案例綠燈，既有 Worker 測試不受影響。

- [ ] **Step 7: Mutation 驗證守門**

把內層 `json_each(CASE WHEN … END)` 改回裸的 `json_each(json_extract(cards.value, '$.assignmentWindows'))`，
確認「survives a scalar card member」測試轉紅（應為 500）；復原後重跑全綠。

- [ ] **Step 8: Commit**

```bash
git add worker-sync/src/assignments.ts worker-sync/src/router.ts worker-sync/test/assignments.integration.test.ts
git commit -m "feat: 新增 /assignments 端點"
```

---

### Task 4: Client 型別、API 與路由

**Files:**
- Modify: `app/projects/types.ts`
- Modify: `app/projects/api.ts`（`getCalendar` 之後）
- Modify: `app/projects/navigation.ts:15-20,76-106,117-158`
- Test: `tests/project-api.test.ts`、`tests/project-navigation.test.ts`

**Interfaces:**
- Consumes: `assertResourceId`、`requestJson`、`asRecord`、`invalidResponse`（皆在 `app/projects/api.ts` 內）。
- Produces:
  - `export type ResourceBar`、`ResourcePerson`、`ResourceUnscheduled`、`ResourceData`（`app/projects/types.ts`）
  - `export async function getAssignments(config: SyncConfig, workspaceId: string, from: string, to: string): Promise<ResourceData>`
  - `ProjectRoute` 新增 `{ kind: "resources"; from: string | null }`
  - `canViewCalendar` 改名為 `canViewManagerViews`（同一組判斷同時管日曆與甘特圖）
  - `BoardAccess` 新增 `canManageAssignments: boolean`

- [ ] **Step 1: 寫失敗測試**

`tests/project-navigation.test.ts` 加入：

```ts
test("parses the resources route with and without a from parameter", () => {
  assert.deepEqual(parseProjectHash("#/resources"), { kind: "resources", from: null });
  assert.deepEqual(
    parseProjectHash("#/resources?from=2026-08-07"),
    { kind: "resources", from: "2026-08-07" },
  );
  assert.deepEqual(
    parseProjectHash("#/resources?from=2026-8-7"),
    { kind: "resources", from: null },
  );
});

test("serializes the resources route", () => {
  assert.equal(
    serializeProjectRoute({ kind: "resources", from: "2026-08-07" }),
    "#/resources?from=2026-08-07",
  );
  assert.equal(serializeProjectRoute({ kind: "resources", from: null }), "#/resources");
});

test("resources route follows the same gate as the calendar", () => {
  const ownerProjects = [
    { id: "p1", name: "A", status: "active", myRole: "owner" } as ProjectSummary,
  ];
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "resources", from: null }, ownerProjects, null, false),
    { kind: "resources", from: null },
  );
  const memberProjects = [
    { id: "p1", name: "A", status: "active", myRole: "member" } as ProjectSummary,
  ];
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "resources", from: null }, memberProjects, null, false),
    { kind: "projects" },
  );
});

test("deriveBoardAccess grants assignment management only to the project owner", () => {
  assert.equal(deriveBoardAccess("owner", "active", "active").canManageAssignments, true);
  assert.equal(deriveBoardAccess("member", "active", "active").canManageAssignments, false);
  assert.equal(deriveBoardAccess("owner", "archived", "active").canManageAssignments, false);
});
```

`tests/project-api.test.ts` 加入。沿用該檔既有的 fetch stub 慣例（下列 `withFetch` 為佔位，
換成檔內實際的 stub 輔助）：

```ts
const VALID_BAR = {
  userId: ALICE,
  cardId: "c1",
  title: "共同任務",
  startDate: "2026-08-07",
  endDate: "2026-08-13",
  projectId: "p1",
  projectName: "覓夜",
  boardId: "b1",
  boardName: "主看板",
  blocked: false,
  serviceClass: "standard",
};

const VALID_BODY = {
  from: "2026-08-07",
  to: "2026-08-20",
  scope: "workspace",
  people: [{ userId: ALICE, displayName: "律師甲" }],
  bars: [VALID_BAR],
  unscheduled: [],
  barsTruncated: false,
  unscheduledTruncated: false,
  boardsTruncated: false,
  requestId: "req-1",
};

test("getAssignments parses a well-formed response", async () => {
  const data = await withFetch(VALID_BODY, (config) =>
    getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20"));
  assert.equal(data.scope, "workspace");
  assert.deepEqual(data.people, [{ userId: ALICE, displayName: "律師甲" }]);
  assert.equal(data.bars.length, 1);
  assert.equal(data.bars[0].endDate, "2026-08-13");
  assert.equal(data.boardsTruncated, false);
});

test("getAssignments rejects a bar missing startDate", async () => {
  const bad = { ...VALID_BAR };
  delete (bad as Record<string, unknown>).startDate;
  await assert.rejects(
    withFetch({ ...VALID_BODY, bars: [bad] }, (config) =>
      getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20")),
    /invalid_response/,
  );
});

test("getAssignments rejects a non-array people field", async () => {
  await assert.rejects(
    withFetch({ ...VALID_BODY, people: "nope" }, (config) =>
      getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20")),
    /invalid_response/,
  );
});

test("getAssignments rejects an unknown scope", async () => {
  await assert.rejects(
    withFetch({ ...VALID_BODY, scope: "everything" }, (config) =>
      getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20")),
    /invalid_response/,
  );
});

test("getAssignments sends workspaceId, from and to as query parameters", async () => {
  let requested = "";
  await withFetch(VALID_BODY, (config) =>
    getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20"), (url) => {
      requested = url;
    });
  assert.match(requested, /\/assignments\?/);
  assert.match(requested, new RegExp(`workspaceId=${WORKSPACE_ID}`));
  assert.match(requested, /from=2026-08-07/);
  assert.match(requested, /to=2026-08-20/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -B 2 -A 6 "resources\|getAssignments" | head -40`
Expected: FAIL——`getAssignments` 不存在、`resources` 路由回 null。

- [ ] **Step 3: 加型別**

`app/projects/types.ts`：

```ts
export type ResourceBar = {
  userId: string;
  cardId: string;
  title: string;
  startDate: string;
  endDate: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
  blocked: boolean;
  serviceClass: ServiceClass;
};

export type ResourcePerson = { userId: string; displayName: string };

export type ResourceUnscheduled = {
  cardId: string;
  title: string;
  userId: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
};

export type ResourceData = {
  from: string;
  to: string;
  scope: "workspace" | "owned_projects";
  people: ResourcePerson[];
  bars: ResourceBar[];
  unscheduled: ResourceUnscheduled[];
  barsTruncated: boolean;
  unscheduledTruncated: boolean;
  boardsTruncated: boolean;
};
```

`ServiceClass` 從 `../board-model` import，比照 `CalendarCard` 現有寫法。

- [ ] **Step 4: 加 client API**

`app/projects/api.ts` 在 `getCalendar` 之後新增 `getAssignments`。嚴格 parser 是硬要求：
任何欄位型別不符就拋 `invalidResponse(operation)`，不得用預設值掩蓋。比照
`parseCalendarCardList` 寫 `parseResourceBars`、`parseResourcePeople`、`parseResourceUnscheduled`
三個 helper。

- [ ] **Step 5: 加路由與可見性**

`app/projects/navigation.ts`：

1. `ProjectRoute` 加 `| { kind: "resources"; from: string | null }`。
2. `parseProjectHash` 加分支，`from` 用 `/^\d{4}-\d{2}-\d{2}$/` 驗，不符則 null：

```ts
  if (path === "resources" || path.startsWith("resources?")) {
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    const from = new URLSearchParams(query).get("from");
    return {
      kind: "resources",
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
    };
  }
```

3. `serializeProjectRoute` 加分支。
4. **把 `canViewCalendar` 改名為 `canViewManagerViews`**，並讓 `calendar` 與 `resources` 兩個
   分支共用。留著 `canViewCalendar` 這個名字去 gate 甘特圖會誤導後人以為只影響日曆，改動一邊
   會靜默改動另一邊。呼叫點：`app/projects/navigation.ts` 自身、
   `app/components/projects/ProjectApp.tsx`、`tests/project-navigation.test.ts`；`pnpm typecheck`
   會抓出漏改。
5. `BoardAccess` 加 `canManageAssignments: boolean`，`deriveBoardAccess` 的四個 return 都要補：
   archived 專案／archived 看板／viewer 三個提早 return 皆為 `false`，最後一個為
   `canManageProject(role)`。`app/components/board/BoardApp.tsx:152`（legacy 本機看板）補
   `canManageAssignments: true`，`:168` 補 `false`。

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add app/projects/types.ts app/projects/api.ts app/projects/navigation.ts app/components/board/BoardApp.tsx tests/project-api.test.ts tests/project-navigation.test.ts
git commit -m "feat: 甘特圖 client 型別、API 與路由"
```

---

### Task 5: 純函式模組 `resource-model.ts`

**Files:**
- Create: `app/projects/resource-model.ts`
- Test: `tests/resource-model.test.ts`（新增）

**Interfaces:**
- Consumes: `ResourceBar`（`app/projects/types.ts`）。
- Produces:
  - `export function dayRange(from: string, to: string): string[]`
  - `export function shiftRange(from: string, to: string, deltaDays: number): { from: string; to: string }`
  - `export function rangeFrom(start: string): { from: string; to: string }`（自 `start` 起 14 天，含頭尾）
  - `export function barSpanInWindow(bar: { startDate: string; endDate: string }, days: string[]): { startIndex: number; span: number } | null`
  - `export function packLanes(bars: ResourceBar[]): Array<{ bar: ResourceBar; lane: number }>`
  - `export function overloadedDays(bars: ResourceBar[], days: string[]): Map<string, number>`
  - `export function groupBarsByUser(bars: ResourceBar[]): Map<string, ResourceBar[]>`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/resource-model.test.ts`。全部日期以字串常數寫死，**不得使用 `new Date()` 取今天**
——那會讓測試在某些日期失敗。至少涵蓋：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 3 "resource-model"`
Expected: FAIL，模組不存在。

- [ ] **Step 3: 實作模組**

建立 `app/projects/resource-model.ts`。日期運算一律走 UTC（`Date.parse(\`${day}T00:00:00Z\`)`
與 86_400_000 加減）再格式化回 `YYYY-MM-DD`，避免本地時區讓跨月邊界偏一天。`packLanes` 用
貪婪演算法：依 `startDate`、`endDate`、`cardId` 排序後，逐條找第一個「最後結束日 < 本條開始日」
的 lane，找不到就開新 lane。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 獨立驗算**

不要只信測試。用 `node -e` 對 `dayRange` 抽驗三個極端時區（`TZ=Pacific/Kiritimati`、
`TZ=Pacific/Niue`、`TZ=Asia/Taipei`）下的同一組輸入，確認結果完全一致；把觀察到的輸出寫進
Task 報告。

- [ ] **Step 6: Commit**

```bash
git add app/projects/resource-model.ts tests/resource-model.test.ts
git commit -m "feat: 甘特圖排版純函式模組"
```

---

### Task 6: `ResourceView` 與導覽入口

**Files:**
- Create: `app/components/projects/ResourceView.tsx`
- Modify: `app/components/projects/WorkspaceEntryNav.tsx`
- Modify: `app/components/projects/ProjectApp.tsx`
- Modify: `app/globals.css`
- Modify: `app/components/projects/CalendarView.tsx`（補新的 nav prop）
- Modify: `app/components/projects/MyProjectsView.tsx`、`AdminProjectsView.tsx`（補新的 nav prop）

**Interfaces:**
- Consumes: `getAssignments`、`ResourceData`、`resource-model.ts` 全部 export、
  `todayString`（`app/projects/calendar-model.ts`，已 export）、
  `calendarWorkspaceId`（`app/projects/session.ts`）、`canViewManagerViews`、`LegacyMigrationGate`。
- Produces: `export function ResourceView(props: { config: SyncConfig; workspaceId: string; from: string; to: string; userName: string; showAdmin: boolean; onSignOut: () => void })`

- [ ] **Step 1: 導覽新增入口**

`WorkspaceEntryNav.tsx`：`current` union 加 `"resources"`，props 加 `showResources: boolean`，
在日曆連結之後加：

```tsx
        {showResources && (
          <a
            href="#/resources"
            className={current === "resources" ? "active" : ""}
            aria-current={current === "resources" ? "page" : undefined}
          >
            <strong>人力甘特圖</strong>
            <small>誰有空、誰被排爆</small>
          </a>
        )}
```

四個呼叫點（`MyProjectsView`、`AdminProjectsView` ×2、`CalendarView`、新的 `ResourceView`）
都要補 `showResources`。`MyProjectsView` 的值由 `ProjectApp` 以 `canViewManagerViews` 算出，
與 `showCalendar` 相同；admin 專屬畫面比照該處 `showAdmin` 現有寫法。

- [ ] **Step 2: 實作 ResourceView**

結構比照 `CalendarView.tsx`：`useEffect` 取資料、三態 `CalendarLoadState` 同型的
loading／error／ready、錯誤訊息用該檔既有的錯誤 mapping。畫面要有：

- 標題與範圍說明，前後移動按鈕（呼叫 `shiftRange` 並改 `window.location.hash`）。
- 日期表頭，每格顯示日與週幾（繁中「一」～「日」）。
- 每人一列；列內以 `packLanes` 的 lane index 決定第幾條子列，`barSpanInWindow` 決定
  `grid-column: <startIndex + 1> / span <span>`。
- **過載標示**：`overloadedDays` 回傳的日子在該人列上加 `.resourceOverload`，並在該格放
  可讀文字（例：`{count} 項並行`）。文字與樣式雙區隔，不只靠顏色。
- 條子上的阻塞與加急沿用三態原則：文字「卡住」「加急」加對應 class。
- 完全沒有條子的人仍要有一列，顯示「本期間無排程」。
- 側欄「未排期指派」列出 `unscheduled`，每筆顯示卡片標題、專案與成員名。
- 三個截斷旗標各自顯示明確的繁中提示。
- 成員名稱查表用 `Map`，找不到時顯示「已離開 (短ID)」——格式與 `CardItem.tsx` 一致。
- `.resourceNarrowNotice` 恆在 DOM，由 CSS 在 899px 切換。

- [ ] **Step 3: CSS**

`app/globals.css` 比照日曆那一段新增 `.resourceShell`、`.resourceLayout`、`.resourceGrid`、
`.resourceRow`、`.resourceBar`（`.blocked`／`.expedite` 變體用與 `.card` 相同的樣式語彙）、
`.resourceOverload`、`.resourceNarrowNotice`。斷點與日曆一致：

```css
@media (max-width: 899px) {
  .resourceLayout { display: none; }
  .resourceNarrowNotice { display: block; }
}
```

- [ ] **Step 4: 接上路由**

`ProjectApp.tsx` 在 calendar 分支之後新增 resources 分支。範圍一次算出，避免 `from` 來自 URL
時 `to` 還停在今天那一段：

```tsx
    const range = rangeFrom(route.from ?? todayString());
```

`from={range.from}`、`to={range.to}`；`workspaceId` 用
`calendarWorkspaceId(bootstrap.session)`；`showAdmin` 用 `hasPlatformAdminAccess(bootstrap.session)`。
**必須包在 `LegacyMigrationGate` 內**，與其他五個路由一致——漏掉會讓甘特圖成為唯一可繞過
強制 token 換發的已登入路由。

- [ ] **Step 5: 驗證**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠。React 元件沒有測試 harness，所以請額外用 `pnpm dev` 手動開
`#/resources?from=2026-08-07` 目視確認條子位置、過載標示與 899px 斷點，並把觀察寫進報告。

- [ ] **Step 6: Commit**

```bash
git add app/components/projects app/globals.css
git commit -m "feat: 人力甘特圖檢視與導覽入口"
```

---

### Task 7: 卡片面板的每人期間輸入

**Files:**
- Modify: `app/components/board/DetailModal.tsx`
- Modify: `app/components/board/BoardApp.tsx`（傳入 `canManageAssignments`）
- Modify: `app/globals.css`
- Test: `tests/board-draft.test.ts`

**Interfaces:**
- Consumes: `CardDraft.assignmentWindows`、`AssignmentWindow`、`BoardAccess.canManageAssignments`。
- Produces: 卡片面板可為每位已勾選的指派人設定起訖日；非 owner 唯讀。

- [ ] **Step 1: 寫失敗測試**

`tests/board-draft.test.ts` 加入（測 draft 層行為，不測 React）：

```ts
test("draftToCardInput drops windows for unassigned users", () => {
  const draft = {
    ...createDraft(),
    title: "卡",
    assigneeUserIds: [ALICE],
    assignmentWindows: [
      { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
      { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-13" },
    ],
  };
  assert.deepEqual(draftToCardInput(draft).assignmentWindows, [
    { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
});

test("draftFromCard round-trips windows without sharing references", () => {
  // 改動 draft 的 window 不得影響原 card
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test 2>&1 | grep -A 3 "board-draft"`
Expected: FAIL（若 Task 1 已讓它通過，改為斷言 window 物件不共用參照的那一條會失敗）。

- [ ] **Step 3: 實作 UI**

`DetailModal.tsx` 在「任務負責人（可複選）」fieldset 之後新增一個 fieldset
「投入期間」，只列出目前已勾選的指派人（含 departed）。每人一列，兩個
`<input type="date">`。`canManageAssignments` 為 false 時：整個指派 fieldset 與期間 fieldset
的輸入都加 `disabled`，並顯示「指派與排程由專案管理者負責。」。

輸入處理三條規則，都要有可讀的繁中提示：

1. 兩個日期都空 → 該人視為未排期，不寫入 window。提示：「兩個日期都填寫後才會排入甘特圖。」
2. 只填一個 → 同樣不寫入，沿用同一句提示。
3. 結束日早於開始日 → 顯示「結束日不可早於開始日。」，並讓送出按鈕 `disabled`。

勾掉某位指派人時，UI 立即不再顯示他的期間列；實際丟棄由 `draftToCardInput` 完成。

- [ ] **Step 4: 傳入權限旗標**

`BoardApp.tsx` 把 `access.canManageAssignments` 傳進 `DetailModal`。既有的 `readOnly`
語意不變（整卡唯讀），`canManageAssignments` 只管指派與期間。

- [ ] **Step 5: CSS**

`app/globals.css` 新增 `.assignmentWindowRow`、`.assignmentWindowError`，沿用既有
`.fieldGroup`／`.fieldHint` 的語彙。

- [ ] **Step 6: 驗證**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠。另用 `pnpm dev` 以 owner 與 member 兩種角色手動確認唯讀行為與三條輸入規則，
把觀察寫進報告。

- [ ] **Step 7: Commit**

```bash
git add app/components/board app/globals.css tests/board-draft.test.ts
git commit -m "feat: 卡片面板設定每人投入期間"
```

---

### Task 8: 文件與完整品質關卡

**Files:**
- Modify: `README.md`
- Modify: `NextTasks.md`

- [ ] **Step 1: README**

「功能」清單新增一行：

```markdown
- 管理者專屬的人力甘特圖：以人為列、以日期為軸顯示每人投入期間、過載與未排期（桌面專用）。
```

「Project／Board 與同步行為」新增三行：

```markdown
- 指派名單與每人投入期間只有 Project owner 可變更；member 可編輯卡片其他欄位。
- 每張卡片的每位指派人可有各自的計畫投入期間；沒有期間的指派在甘特圖上列為未排期，
  不會被視為錯誤，也不阻擋任何編輯。
- 每人投入期間隨卡片整體 LWW 合併，不做欄位級合併；兩台裝置同時改同一張卡的不同人期間時，
  後寫入者整份覆蓋。這是維持卡片級 LWW 簡單性所接受的精度損失。
```

「相關文件」新增規格與計畫兩個連結。

- [ ] **Step 2: NextTasks 狀態表**

新增一列（`| 人力甘特圖 v1 | 已實作，待 staging 部署與驗收 | …`），內容涵蓋：schema v8
`assignmentWindows`；指派與期間收斂為 Project owner（以簽章比對，缺席鍵視為空陣列）；
`GET /assignments?workspaceId=&from=&to=`，窗長上限 31 天；雙層 `json_each` 且內層以 `CASE`
守門；上限 50 看板／2000 bars／200 未排期，三者皆有旗標；v1 純檢視、桌面專用。

- [ ] **Step 3: NextTasks 驗收清單**

在 P0-4 新增「人力甘特圖」小節，逐條抄規格 §8 的 14 項驗收條件為 `- [ ]`。

- [ ] **Step 4: 九項品質關卡**

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

- [ ] **Step 5: Commit**

```bash
git add README.md NextTasks.md
git commit -m "docs: 記錄人力甘特圖 v1"
```

---

## 部署備註

本功能**沒有 D1 migration**（`assignmentWindows` 住在 `boards.data` 的 JSON blob 內）。
但有 schema 版本升級與權限收緊，部署順序不可顛倒：

1. 先 `pnpm sync:deploy:staging`——Worker 必須先能接受並驗證 `assignmentWindows`，否則
   v8 客戶端送上來的新欄位會被舊 Worker 原樣存入而未經驗證。
2. 再 `pnpm web:deploy:beta`。
3. 部署後確認：無 token 對 `/assignments` 回 401；member 帳號改指派得 403；舊看板的 member
   編輯仍得 200（lockout 回歸的線上確認）。
