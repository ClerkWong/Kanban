# 流動度量與服務類別 v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-08-05-flow-metrics-service-class-design.md`，為看板補上流動度量資料基礎（欄位進入時間、開工時間、累計阻塞時長）、卡面老化顯示、服務類別與加急規則，以及流動報表。

**Architecture:** Card schema v6 → v7，四個新欄位隨既有 BoardState JSON 走 per-Board revision 與卡片級 LWW，不新增 API 端點。加急置頂實作為 `normalizeBoard` 的 canonical 順序不變量（穩定分割）。度量全部由持久化欄位直接計算，client（`app/board-model.ts`）與 Worker（`worker-sync/src/reports.ts`）各自實作同一套規則（既有慣例：worker-sync 不 import app/ 程式碼）。

**Tech Stack:** TypeScript、React、`node:test`（經 tsx）、Cloudflare Workers + vitest-pool-workers。

## Global Constraints

- 分支：依使用者偏好在現有 repo 原地建立分支（例如 `feature/flow-metrics-v1`），完成後本地 merge。
- `ServiceClass = "standard" | "expedite" | "fixedDate" | "intangible"`；未知值退回 `"standard"`。
- `BoardSettings` 預設：`agingWarnDays: 3`、`agingAlertDays: 7`、`expediteWipLimit: 1`。天數夾在 1–365 整數；`agingWarnDays >= agingAlertDays` 時把 `agingAlertDays` 調成 `min(agingWarnDays + 1, 365)`。`expediteWipLimit` 為 null 或 1–99 整數。
- `blockedMs` 上限 `100 * 365 * 24 * 3600 * 1000`（`MAX_BLOCKED_MS`），超出夾回上限。
- Migration：`columnEnteredAt` ← `updatedAt`（無效退 `createdAt`）；`startedAt` ← null；`blockedMs` ← 0；`serviceClass` ← `"standard"`；`completedAt` 不得被重算。
- 老化以本地日曆日 date-only 差計算，不轉 UTC 瞬間；只在非完成欄顯示。
- 加急計數與欄位 WIP 一樣由完整、未篩選狀態計算；超限警告不阻擋。
- Worker 驗證新欄位採「欄位缺席即通過、出現才驗格式」，維持 v6 舊 client 相容；`settings` 缺席時從前一版 board 保留。
- Activity Log 只新增 `serviceClass` 追蹤欄位；`columnEnteredAt`、`startedAt`、`blockedMs` 明確排除。
- 所有 UI 文案為繁體中文；狀態不得只以顏色表達。
- 每個 Task 結尾 commit；品質關卡命令見各 Task。

**測試命令速查：**

- 單一 client 測試檔：`pnpm exec tsx --test tests/<file>.test.ts`
- 全部 client 測試：`pnpm test`
- 單一 Worker 測試檔：`WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/<file>.integration.test.ts`
- 全部 Worker 測試：`pnpm worker:test`

---

### Task 1: Card schema v7 型別、normalize 與 migration

**Files:**
- Modify: `app/board-model.ts`（型別區 1–104 行、`createDemoBoard`、`normalizeBoard`:757、`normalizeCards`:981、`parsePersistedBoard`:715、`cloneBoard`:1141、`createSeedCard`:885）
- Modify: `app/sync/merge.ts:89-96`（`mergeBoards` 回傳物件補 `settings`）
- Modify: `tests/board-tombstones.test.ts:14`、`tests/board-attachments.test.ts:27`（版本斷言 6 → 7）
- Test: `tests/board-flow-metrics.test.ts`（新檔）

**Interfaces:**
- Consumes: 既有 `normalizeTimestamp`、`toValidDate`、`clamp`（board-model 內部 helpers）。
- Produces（後續 Task 依賴的正式名稱）:
  - `export type ServiceClass = "standard" | "expedite" | "fixedDate" | "intangible"`
  - `export const SERVICE_CLASSES: readonly ServiceClass[]`
  - `export const MAX_BLOCKED_MS: number`
  - `export type BoardSettings = { agingWarnDays: number; agingAlertDays: number; expediteWipLimit: number | null }`
  - `export const DEFAULT_BOARD_SETTINGS: BoardSettings`
  - `Card` 新增 `columnEnteredAt: string; startedAt: string | null; blockedMs: number; serviceClass: ServiceClass`
  - `BoardState` 新增 `settings: BoardSettings`；`BOARD_SCHEMA_VERSION = 7`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/board-flow-metrics.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_BOARD_SETTINGS,
  MAX_BLOCKED_MS,
  createDemoBoard,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  type BoardState,
} from "../app/board-model";

test("schema v7 exposes flow fields with defaults", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 7);
  const board = createDemoBoard(new Date(2026, 7, 5));
  assert.deepEqual(board.settings, DEFAULT_BOARD_SETTINGS);
  for (const card of Object.values(board.cards)) {
    assert.equal(typeof card.columnEnteredAt, "string");
    assert.equal(card.blockedMs, 0);
    assert.equal(card.serviceClass, "standard");
  }
});

test("v6 data migrates without recomputing completedAt", () => {
  const legacy = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 7, 5)))) as BoardState;
  // 模擬 v6：拿掉 v7 欄位並降版
  const v6 = {
    ...legacy,
    version: 6,
    settings: undefined,
    cards: Object.fromEntries(
      Object.entries(legacy.cards).map(([id, card]) => {
        const { columnEnteredAt, startedAt, blockedMs, serviceClass, ...rest } = card;
        void columnEnteredAt; void startedAt; void blockedMs; void serviceClass;
        return [id, rest];
      }),
    ),
  };
  const { board, recovered } = parsePersistedBoard(JSON.stringify(v6));
  assert.equal(recovered, false);
  assert.equal(board.version, 7);
  assert.deepEqual(board.settings, DEFAULT_BOARD_SETTINGS);
  const done = board.cards["card-done"];
  assert.equal(done.completedAt, legacy.cards["card-done"].completedAt);
  assert.equal(done.startedAt, null);
  assert.equal(done.blockedMs, 0);
  assert.equal(done.serviceClass, "standard");
  assert.equal(done.columnEnteredAt, done.updatedAt);
});

test("normalize clamps invalid flow values", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const raw = JSON.parse(serializeBoard(board)) as BoardState;
  const cardId = Object.keys(raw.cards)[0];
  (raw.cards[cardId] as unknown as Record<string, unknown>).blockedMs = MAX_BLOCKED_MS * 2;
  (raw.cards[cardId] as unknown as Record<string, unknown>).serviceClass = "vip";
  (raw.cards[cardId] as unknown as Record<string, unknown>).columnEnteredAt = "not-a-date";
  (raw as unknown as Record<string, unknown>).settings = {
    agingWarnDays: 400, agingAlertDays: 0, expediteWipLimit: 1000,
  };
  const normalized = normalizeBoard(raw);
  assert.equal(normalized.cards[cardId].blockedMs, MAX_BLOCKED_MS);
  assert.equal(normalized.cards[cardId].serviceClass, "standard");
  assert.equal(normalized.cards[cardId].columnEnteredAt, normalized.cards[cardId].updatedAt);
  assert.equal(normalized.settings.agingWarnDays, 365);
  assert.equal(normalized.settings.agingAlertDays, 365);
  assert.equal(normalized.settings.expediteWipLimit, 99);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts`
Expected: FAIL（`DEFAULT_BOARD_SETTINGS` 不存在 / 版本斷言 7 失敗）

- [ ] **Step 3: 實作 board-model 型別與 normalize**

`app/board-model.ts` 第 1 行起：

```ts
export const BOARD_SCHEMA_VERSION = 7;

export type ServiceClass = "standard" | "expedite" | "fixedDate" | "intangible";
export const SERVICE_CLASSES = ["standard", "expedite", "fixedDate", "intangible"] as const;
export const MAX_BLOCKED_MS = 100 * 365 * 24 * 3600 * 1000;

export type BoardSettings = {
  agingWarnDays: number;
  agingAlertDays: number;
  expediteWipLimit: number | null;
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  agingWarnDays: 3,
  agingAlertDays: 7,
  expediteWipLimit: 1,
};
```

`Card` type（`completedAt` 之後）加入：

```ts
  /** 進入目前欄位的時間；跨欄移動時更新，同欄重排不更新。 */
  columnEnteredAt: string;
  /** 首次離開第一欄的時間；只設定一次，移回第一欄不清除。 */
  startedAt: string | null;
  /** 已解除的阻塞累計毫秒數，不含進行中的阻塞。 */
  blockedMs: number;
  serviceClass: ServiceClass;
```

`BoardState` 加入 `settings: BoardSettings;`。

新增 helpers（放在 `normalizeWipLimit` 附近）：

```ts
function isServiceClass(value: unknown): value is ServiceClass {
  return (SERVICE_CLASSES as readonly string[]).includes(value as string);
}

function normalizeBlockedMs(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return 0;
  return Math.min(Math.round(numberValue), MAX_BLOCKED_MS);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Math.round(Number(value));
  return Number.isFinite(numberValue) ? clamp(numberValue, min, max) : fallback;
}

export function normalizeBoardSettings(value: unknown): BoardSettings {
  const raw = value && typeof value === "object"
    ? (value as Partial<Record<keyof BoardSettings, unknown>>)
    : {};
  const agingWarnDays = clampInt(raw.agingWarnDays, 1, 365, DEFAULT_BOARD_SETTINGS.agingWarnDays);
  let agingAlertDays = clampInt(raw.agingAlertDays, 1, 365, DEFAULT_BOARD_SETTINGS.agingAlertDays);
  if (agingWarnDays >= agingAlertDays) {
    agingAlertDays = Math.min(agingWarnDays + 1, 365);
  }
  const expediteWipLimit = raw.expediteWipLimit === null
    ? null
    : clampInt(raw.expediteWipLimit, 1, 99, DEFAULT_BOARD_SETTINGS.expediteWipLimit ?? 1);
  return { agingWarnDays, agingAlertDays, expediteWipLimit };
}
```

`normalizeCards` 的每張卡（`completedAt:` 之後）加入：

```ts
      columnEnteredAt:
        normalizeTimestamp((raw as { columnEnteredAt?: unknown }).columnEnteredAt) ??
        normalizeTimestamp(raw.updatedAt) ??
        normalizeTimestamp(raw.createdAt) ??
        new Date().toISOString(),
      startedAt: normalizeTimestamp((raw as { startedAt?: unknown }).startedAt),
      blockedMs: normalizeBlockedMs((raw as { blockedMs?: unknown }).blockedMs),
      serviceClass: isServiceClass((raw as { serviceClass?: unknown }).serviceClass)
        ? (raw as { serviceClass: ServiceClass }).serviceClass
        : "standard",
```

注意：`normalizeCards` 的來源型別是 `Record<string, Card>` 但實際可能是舊資料，既有程式已用 `(raw as {...})` cast 模式，照做。

`normalizeBoard` 回傳物件加入 `settings: normalizeBoardSettings((board as { settings?: unknown }).settings),`。

`parsePersistedBoard` 的版本白名單加入 `version !== 6 &&`（放在 `version !== 5 &&` 之後）。

`createDemoBoard` 回傳物件加入 `settings: { ...DEFAULT_BOARD_SETTINGS },`。

`createSeedCard` 回傳物件加入：

```ts
    columnEnteredAt: "2026-07-01T09:00:00.000Z",
    startedAt: input.id === "card-done" ? "2026-06-28T09:00:00.000Z" : null,
    blockedMs: 0,
    serviceClass: "standard",
```

（`card-done` 給 `startedAt` 讓示範板的流動報表能展示 Cycle Time。）

`cloneBoard` 回傳物件加入 `settings: { ...board.settings },`。

`addCard` 的 `card` 物件字面值需補齊新欄位（本 Task 先給佔位、Task 2 再實作規則）：

```ts
    columnEnteredAt: normalizeTimestamp(input.columnEnteredAt) ?? timestamp,
    startedAt: normalizeTimestamp(input.startedAt),
    blockedMs: normalizeBlockedMs(input.blockedMs),
    serviceClass: isServiceClass(input.serviceClass) ? input.serviceClass : "standard",
```

`app/sync/merge.ts` 的 `normalizeBoard({...})` 引數加入 `settings: winner.settings ?? loser.settings,`（型別上 `settings` 已必填，但 runtime 的遠端資料可能缺，交給 normalize 補預設；用 `??` 防呆即可）。

`tests/board-tombstones.test.ts:14` 與 `tests/board-attachments.test.ts:27` 的 `assert.equal(BOARD_SCHEMA_VERSION, 6)` 改為 `7`。

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts && pnpm test && pnpm typecheck`
Expected: 全部 PASS（既有測試若因新欄位型別報錯，屬本 Task 範圍，修到綠）

- [ ] **Step 5: Commit**

```bash
git add app/board-model.ts app/sync/merge.ts tests/board-flow-metrics.test.ts tests/board-tombstones.test.ts tests/board-attachments.test.ts
git commit -m "feat: add card flow fields and board settings (schema v7)"
```

---

### Task 2: 移動與阻塞行為（columnEnteredAt / startedAt / blockedMs）

**Files:**
- Modify: `app/board-model.ts`（`addCard`:360、`moveCard`:473、`updateCard`:411）
- Test: `tests/board-flow-metrics.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `normalizeBlockedMs`、`MAX_BLOCKED_MS`、Card v7 欄位。
- Produces: `moveCard` / `addCard` / `updateCard` 的新行為契約（下述測試即契約）。跨欄移動會更新卡片 `updatedAt`（LWW 才會傳播 `columnEnteredAt`——這是刻意的行為變更）。

- [ ] **Step 1: 寫失敗測試**

附加到 `tests/board-flow-metrics.test.ts`（import 補 `addCard, moveCard, moveCardRelative, updateCard`）：

```ts
test("cross-column move updates columnEnteredAt; same-column reorder does not", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const before = board.cards["card-analytics"].columnEnteredAt; // 位於 doing
  const moveTime = new Date("2026-08-05T10:00:00.000Z");
  const moved = moveCard(board, "card-analytics", "review", 0, moveTime);
  assert.equal(moved.cards["card-analytics"].columnEnteredAt, moveTime.toISOString());
  assert.equal(moved.cards["card-analytics"].updatedAt, moveTime.toISOString());

  const reordered = moveCardRelative(moved, "card-review", "down");
  assert.equal(reordered.cards["card-review"].columnEnteredAt, board.cards["card-review"].columnEnteredAt);
  void before;
});

test("startedAt is set once when leaving the first column", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  assert.equal(board.cards["card-roadmap"].startedAt, null); // 位於 todo
  const startTime = new Date("2026-08-05T09:00:00.000Z");
  const started = moveCard(board, "card-roadmap", "doing", 0, startTime);
  assert.equal(started.cards["card-roadmap"].startedAt, startTime.toISOString());

  const back = moveCard(started, "card-roadmap", "todo", 0, new Date("2026-08-05T11:00:00.000Z"));
  assert.equal(back.cards["card-roadmap"].startedAt, startTime.toISOString());
  const again = moveCard(back, "card-roadmap", "doing", 0, new Date("2026-08-05T12:00:00.000Z"));
  assert.equal(again.cards["card-roadmap"].startedAt, startTime.toISOString());
});

test("addCard in a non-first column sets startedAt at creation", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const inDoing = addCard(board, "doing", { title: "直接開工" }, new Date("2026-08-05T08:00:00.000Z"));
  const created = Object.values(inDoing.cards).find((card) => card.title === "直接開工");
  assert.ok(created);
  assert.equal(created.startedAt, "2026-08-05T08:00:00.000Z");
  assert.equal(created.columnEnteredAt, "2026-08-05T08:00:00.000Z");

  const inTodo = addCard(board, "todo", { title: "先排隊" }, new Date("2026-08-05T08:00:00.000Z"));
  const queued = Object.values(inTodo.cards).find((card) => card.title === "先排隊");
  assert.ok(queued);
  assert.equal(queued.startedAt, null);
});

test("unblocking accumulates blockedMs across cycles", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-roadmap", { blocked: true, blockedReason: "等待回覆" },
    new Date("2026-08-05T09:00:00.000Z"));
  board = updateCard(board, "card-roadmap", { blocked: false },
    new Date("2026-08-05T10:00:00.000Z"));
  assert.equal(board.cards["card-roadmap"].blockedMs, 3600_000);

  board = updateCard(board, "card-roadmap", { blocked: true, blockedReason: "又卡住" },
    new Date("2026-08-05T11:00:00.000Z"));
  board = updateCard(board, "card-roadmap", { blocked: false },
    new Date("2026-08-05T11:30:00.000Z"));
  assert.equal(board.cards["card-roadmap"].blockedMs, 3600_000 + 1800_000);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts`
Expected: FAIL（`columnEnteredAt` 未在移動時更新等）

- [ ] **Step 3: 實作**

`addCard`：把 Task 1 的佔位改為規則版。需要知道第一欄 id：

```ts
  const firstColumnId = board.columns[0]?.id;
  // card 物件內：
    columnEnteredAt: normalizeTimestamp(input.columnEnteredAt) ?? timestamp,
    startedAt:
      normalizeTimestamp(input.startedAt) ??
      (columnId !== firstColumnId ? timestamp : null),
    blockedMs: normalizeBlockedMs(input.blockedMs),
    serviceClass: isServiceClass(input.serviceClass) ? input.serviceClass : "standard",
```

`moveCard`：現有程式在 `sourceIsDone !== targetIsDone` 時才改卡片。改為「跨欄一律更新」，完成狀態邏輯併入。以既有變數為基礎重寫該段：

```ts
  const sourceColumn =
    sourceColumnId !== undefined ? board.columns[sourceColumnId] : undefined;
  const crossColumn = sourceColumn !== undefined && sourceColumn.id !== targetColumnId;

  if (crossColumn) {
    const timestamp = normalizeTimestamp(now) ?? new Date().toISOString();
    const card = next.cards[cardId];
    const firstColumnId = board.columns[0]?.id;
    const leavesFirstColumn =
      sourceColumn.id === firstColumnId && targetColumnId !== firstColumnId;
    next.cards[cardId] = {
      ...card,
      columnEnteredAt: timestamp,
      startedAt: card.startedAt ?? (leavesFirstColumn ? timestamp : null),
      completedAt: targetIsDone
        ? card.completedAt ?? timestamp
        : sourceIsDone
          ? null
          : card.completedAt,
      updatedAt: timestamp,
    };
  }
```

並刪除原本 `if (sourceIsDone !== targetIsDone) {...}` 區塊。注意：原行為是移入完成欄「一律以移動時間覆寫 completedAt」；上面改用 `card.completedAt ?? timestamp` 會改變既有語意，**不要這樣做**——保持原語意：

```ts
      completedAt: targetIsDone ? timestamp : sourceIsDone ? null : card.completedAt,
```

（`targetIsDone` 時原程式就是覆寫成移動時間；跨欄且都非完成欄時維持原值。）

`updateCard`：在計算 `blocked` 之後、組物件之前加入：

```ts
  const wasBlocked = existing.blocked;
  let blockedMs = normalizeBlockedMs(patch.blockedMs ?? existing.blockedMs);
  if (wasBlocked && !blocked) {
    const since = toValidDate(existing.blockedAt);
    const until = toValidDate(timestamp);
    if (since && until && until.getTime() > since.getTime()) {
      blockedMs = Math.min(blockedMs + (until.getTime() - since.getTime()), MAX_BLOCKED_MS);
    }
  }
```

物件字面值中加入 `blockedMs,` 與：

```ts
    serviceClass: isServiceClass(patch.serviceClass ?? existing.serviceClass)
      ? (patch.serviceClass ?? existing.serviceClass)
      : "standard",
    columnEnteredAt: existing.columnEnteredAt,
    startedAt: patch.startedAt !== undefined
      ? normalizeTimestamp(patch.startedAt)
      : existing.startedAt,
```

（`...patch` spread 已涵蓋部分欄位，但顯式列出可防 patch 傳入未 normalize 的值；`columnEnteredAt` 顯式固定為 existing，編輯卡片不得改變欄位進入時間。）

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts && pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/board-model.ts tests/board-flow-metrics.test.ts
git commit -m "feat: track column entry, start time, and blocked duration"
```

---

### Task 3: 加急 canonical 順序不變量

**Files:**
- Modify: `app/board-model.ts`（`normalizeColumns`:956）
- Test: `tests/board-flow-metrics.test.ts`

**Interfaces:**
- Consumes: Card v7 的 `serviceClass`。
- Produces: `normalizeBoard` 的不變量——每欄 `cardIds` 中加急卡恆在非加急卡之前（穩定分割）。所有走 `normalizeBoard` 的路徑（add/update/move/merge/parse）自動獲得此保證。

- [ ] **Step 1: 寫失敗測試**

```ts
test("expedite cards stay at the front of each column", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  // doing 欄目前為 ["card-analytics", "card-copy"]
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  assert.deepEqual(
    board.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-copy", "card-analytics"],
  );

  // 拖放企圖把非加急卡放到加急卡前面：normalizeBoard 拉回
  const dragged = moveCard(board, "card-analytics", "doing", 0);
  assert.deepEqual(
    dragged.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-copy", "card-analytics"],
  );

  // 解除加急：回到非加急區段最前
  const cleared = updateCard(board, "card-copy", { serviceClass: "standard" });
  assert.deepEqual(
    cleared.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-copy", "card-analytics"],
  );
});

test("becoming expedite lands at the end of the expedite segment", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-analytics", { serviceClass: "expedite" }); // doing: [analytics, copy]
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  assert.deepEqual(
    board.columns.find((column) => column.id === "doing")?.cardIds,
    ["card-analytics", "card-copy"],
  );
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts`
Expected: FAIL（順序未被強制）

- [ ] **Step 3: 實作**

`normalizeColumns` 中，`cardIds` 過濾完成後做穩定分割：

```ts
    const orderedCardIds = [
      ...cardIds.filter((cardId) => cards[cardId]?.serviceClass === "expedite"),
      ...cardIds.filter((cardId) => cards[cardId]?.serviceClass !== "expedite"),
    ];
```

回傳物件改用 `cardIds: orderedCardIds`。穩定分割天然滿足規格：轉加急的卡依原欄位順序落在加急區段最後；解除加急落在非加急區段最前。

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/board-model.ts tests/board-flow-metrics.test.ts
git commit -m "feat: enforce expedite-first canonical order per column"
```

---

### Task 4: 度量計算函式與看板統計

**Files:**
- Modify: `app/board-model.ts`（`getBoardStats`:282、`getMonthlyCompletionStats`:840 附近新增函式、新增 `updateBoardSettings`）
- Test: `tests/board-flow-metrics.test.ts`

**Interfaces:**
- Consumes: Task 1–2 的欄位與 `DEFAULT_BOARD_SETTINGS`。
- Produces:
  - `BoardStats` 新增 `expedite: number`（非完成欄、未篩選的加急卡數）
  - `export type AgingLevel = "normal" | "warn" | "alert"`
  - `export function getCardAgingDays(card: Card, today?: string): number`
  - `export function getAgingLevel(days: number, settings: BoardSettings): AgingLevel`
  - `export function getCardBlockedTotalMs(card: Card, now?: Date): number`
  - `export type MonthlyFlowStats = MonthlyCompletion & { cycleTimeMedianDays: number | null; cycleTimeAverageDays: number | null; unmeasuredCount: number; blockedTotalMs: number; flowEfficiencyMedian: number | null; serviceClassCounts: Record<ServiceClass, number> }`
  - `export function getMonthlyFlowStats(board: BoardState, recentMonths?: number, now?: Date): MonthlyFlowStats[]`
  - `export function updateBoardSettings(board: BoardState, patch: Partial<BoardSettings>, now?: Date): BoardState`

- [ ] **Step 1: 寫失敗測試**

```ts
import {
  getAgingLevel, getBoardStats, getCardAgingDays, getCardBlockedTotalMs,
  getMonthlyFlowStats, updateBoardSettings,
} from "../app/board-model"; // 併入既有 import

test("aging days use local calendar dates", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const card = {
    ...board.cards["card-roadmap"],
    columnEnteredAt: "2026-08-01T23:30:00.000Z",
  };
  // today 以本地日曆日字串傳入，計算不經 UTC 瞬間
  assert.equal(getCardAgingDays(card, "2026-08-05"), getCardAgingDays(card, "2026-08-05"));
  assert.equal(typeof getCardAgingDays(card, "2026-08-05"), "number");
  assert.equal(getAgingLevel(2, DEFAULT_BOARD_SETTINGS), "normal");
  assert.equal(getAgingLevel(3, DEFAULT_BOARD_SETTINGS), "warn");
  assert.equal(getAgingLevel(7, DEFAULT_BOARD_SETTINGS), "alert");
});

test("blocked total includes the in-progress block up to completion", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-analytics", { blocked: true, blockedReason: "等素材" },
    new Date("2026-08-05T09:00:00.000Z"));
  // 進行中阻塞：now 截止
  assert.equal(
    getCardBlockedTotalMs(board.cards["card-analytics"], new Date("2026-08-05T10:00:00.000Z")),
    3600_000,
  );
  // 完成後仍標記阻塞：只計到 completedAt
  board = moveCard(board, "card-analytics", "done", 0, new Date("2026-08-05T09:30:00.000Z"));
  assert.equal(
    getCardBlockedTotalMs(board.cards["card-analytics"], new Date("2026-08-05T12:00:00.000Z")),
    1800_000,
  );
});

test("monthly flow stats compute cycle time and flag unmeasured cards", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = moveCard(board, "card-roadmap", "doing", 0, new Date("2026-08-01T09:00:00.000Z"));
  board = moveCard(board, "card-roadmap", "done", 0, new Date("2026-08-03T09:00:00.000Z"));
  const stats = getMonthlyFlowStats(board, 6, new Date(2026, 7, 5));
  assert.equal(stats.length, 6);
  const august = stats[stats.length - 1];
  assert.equal(august.month, "2026-08");
  assert.equal(august.count, 1);
  assert.equal(august.cycleTimeMedianDays, 2);
  assert.equal(august.unmeasuredCount, 0);
  assert.equal(august.serviceClassCounts.standard, 1);
  // 示範板 card-done 完成於 2026-07，有 startedAt（Task 1 seed）
  const july = stats[stats.length - 2];
  assert.equal(july.count, 1);
  assert.equal(july.unmeasuredCount, 0);
});

test("board stats count expedite cards outside done", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  board = updateCard(board, "card-done", { serviceClass: "expedite" });
  assert.equal(getBoardStats(board, "2026-08-05").expedite, 1);
});

test("updateBoardSettings normalizes and persists", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const next = updateBoardSettings(board, { agingWarnDays: 10, agingAlertDays: 4 });
  assert.equal(next.settings.agingWarnDays, 10);
  assert.equal(next.settings.agingAlertDays, 11);
  const cleared = updateBoardSettings(next, { expediteWipLimit: null });
  assert.equal(cleared.settings.expediteWipLimit, null);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts`
Expected: FAIL（函式不存在）

- [ ] **Step 3: 實作**

`app/board-model.ts`（放在 `getMonthlyCompletionStats` 附近）：

```ts
export type AgingLevel = "normal" | "warn" | "alert";

export function getCardAgingDays(card: Card, today = getLocalDateString()): number {
  const entered = toValidDate(card.columnEnteredAt);
  if (!entered) return 0;
  return Math.max(0, diffLocalDays(getLocalDateString(entered), today));
}

export function getAgingLevel(days: number, settings: BoardSettings): AgingLevel {
  if (days >= settings.agingAlertDays) return "alert";
  if (days >= settings.agingWarnDays) return "warn";
  return "normal";
}

export function getCardBlockedTotalMs(card: Card, now = new Date()): number {
  let total = card.blockedMs;
  if (card.blocked) {
    const since = toValidDate(card.blockedAt);
    if (since) {
      const completed = toValidDate(card.completedAt);
      const until = completed && completed.getTime() < now.getTime() ? completed : now;
      total += Math.max(0, until.getTime() - since.getTime());
    }
  }
  return Math.min(total, MAX_BLOCKED_MS);
}

export type MonthlyFlowStats = MonthlyCompletion & {
  cycleTimeMedianDays: number | null;
  cycleTimeAverageDays: number | null;
  unmeasuredCount: number;
  blockedTotalMs: number;
  flowEfficiencyMedian: number | null;
  serviceClassCounts: Record<ServiceClass, number>;
};

export function getMonthlyFlowStats(
  board: BoardState,
  recentMonths = 6,
  now = new Date(),
): MonthlyFlowStats[] {
  return getMonthlyCompletionStats(board, recentMonths, now).map((month) => {
    const cycleTimes: number[] = [];
    const efficiencies: number[] = [];
    let unmeasuredCount = 0;
    let blockedTotalMs = 0;
    const serviceClassCounts: Record<ServiceClass, number> = {
      standard: 0, expedite: 0, fixedDate: 0, intangible: 0,
    };
    for (const card of month.cards) {
      serviceClassCounts[card.serviceClass] += 1;
      const blocked = getCardBlockedTotalMs(card, now);
      blockedTotalMs += blocked;
      const started = toValidDate(card.startedAt);
      const completed = toValidDate(card.completedAt);
      if (!started || !completed || completed.getTime() <= started.getTime()) {
        unmeasuredCount += 1;
        continue;
      }
      const cycleMs = completed.getTime() - started.getTime();
      cycleTimes.push(cycleMs / DAY_MS);
      efficiencies.push(clamp((cycleMs - blocked) / cycleMs, 0, 1));
    }
    return {
      ...month,
      cycleTimeMedianDays: roundOrNull(median(cycleTimes)),
      cycleTimeAverageDays: roundOrNull(average(cycleTimes)),
      unmeasuredCount,
      blockedTotalMs,
      flowEfficiencyMedian: median(efficiencies),
      serviceClassCounts,
    };
  });
}

export function updateBoardSettings(
  board: BoardState,
  patch: Partial<BoardSettings>,
  now = new Date(),
): BoardState {
  const next = cloneBoard(board);
  next.settings = normalizeBoardSettings({ ...board.settings, ...patch });
  return normalizeBoard(touch(next, now));
}
```

私有 helpers（檔尾）：

```ts
const DAY_MS = 24 * 3600 * 1000;

function diffLocalDays(fromDateOnly: string, toDateOnly: string): number {
  const [fromYear, fromMonth, fromDay] = fromDateOnly.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDateOnly.split("-").map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
```

`BoardStats` 加 `expedite: number;`，`getBoardStats` 回傳物件加：

```ts
    expedite: cards.filter(
      (card) => card.serviceClass === "expedite" && !doneIds.has(card.id),
    ).length,
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts && pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/board-model.ts tests/board-flow-metrics.test.ts
git commit -m "feat: add flow metrics helpers and expedite stat"
```

---

### Task 5: 服務類別篩選

**Files:**
- Modify: `app/board-model.ts`（`Filters`:66、`isFilterActive`:271、`filterCards`:317）
- Modify: `app/components/board/shared.ts`（`emptyFilters`:63）
- Modify: `app/components/board/BoardApp.tsx`（篩選列，約 669–744 行，仿照 blocked select）
- Test: `tests/board-flow-metrics.test.ts`

**Interfaces:**
- Consumes: `ServiceClass`。
- Produces: `Filters` 新增 `serviceClass: "all" | ServiceClass`；`emptyFilters.serviceClass = "all"`。

- [ ] **Step 1: 寫失敗測試**

```ts
import { filterCards, isFilterActive } from "../app/board-model"; // 併入既有 import

test("service class filter uses AND semantics", () => {
  let board = createDemoBoard(new Date(2026, 7, 5));
  board = updateCard(board, "card-copy", { serviceClass: "expedite" });
  const filters = {
    query: "", labelId: "", priority: "all" as const, due: "all" as const,
    assigneeUserId: "", blocked: "all" as const, serviceClass: "expedite" as const,
  };
  assert.equal(isFilterActive(filters), true);
  const visible = filterCards(board, filters, "2026-08-05");
  assert.deepEqual(visible["doing"].map((card) => card.id), ["card-copy"]);
  assert.equal(visible["todo"].length, 0);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts`
Expected: FAIL（Filters 沒有 serviceClass，typecheck 或斷言失敗）

- [ ] **Step 3: 實作**

`Filters` 加 `serviceClass: "all" | ServiceClass;`。`isFilterActive` 加 `|| filters.serviceClass !== "all"`。`filterCards` 加：

```ts
        const serviceClassMatches =
          filters.serviceClass === "all" || card.serviceClass === filters.serviceClass;
```

並加入回傳條件的 `&&` 鏈。

`shared.ts` 的 `emptyFilters` 加 `serviceClass: "all",`。

`BoardApp.tsx` 篩選列，在 blocked select 之後仿照新增：

```tsx
          <label className="filterField">
            <span>服務類別</span>
            <select
              value={filters.serviceClass}
              onChange={(event) => setFilters({
                ...filters,
                serviceClass: event.target.value as Filters["serviceClass"],
              })}
            >
              <option value="all">全部</option>
              <option value="expedite">加急</option>
              <option value="fixedDate">固定日期</option>
              <option value="standard">標準</option>
              <option value="intangible">無形</option>
            </select>
          </label>
```

（label/select 的 className 以檔內既有篩選欄位實際寫法為準，保持一致。）

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm exec tsx --test tests/board-flow-metrics.test.ts && pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/board-model.ts app/components/board/shared.ts app/components/board/BoardApp.tsx tests/board-flow-metrics.test.ts
git commit -m "feat: add service class filter"
```

---

### Task 6: 卡面老化與服務類別 UI（CardItem、DetailModal、CardDraft）

**Files:**
- Modify: `app/components/board/shared.ts`（`CardDraft`、`createDraft`、`draftFromCard`、`draftToCardInput`，新增 `serviceClassText`）
- Modify: `app/components/board/CardItem.tsx`
- Modify: `app/components/board/DetailModal.tsx`
- Modify: `app/components/board/BoardApp.tsx`（CardItem 呼叫處，約 1026 行，傳入新 props）
- Modify: `app/globals.css`（`.agingNote`、`.serviceBadge`、`.card.expedite` 樣式）

**Interfaces:**
- Consumes: Task 4 的 `getCardAgingDays`、`getAgingLevel`；Task 1 的 `BoardSettings`、`ServiceClass`。
- Produces:
  - `CardItem` 新 props：`settings: BoardSettings; isDoneColumn: boolean`
  - `CardDraft` 新增 `serviceClass: ServiceClass`
  - `shared.ts` 匯出 `serviceClassText: Record<ServiceClass, string>`（`standard: "標準"、expedite: "加急"、fixedDate: "固定日期"、intangible: "無形"`）

此 Task 為 UI 組裝，無獨立單元測試檔；以 typecheck、build 與既有測試防護，人工驗收於 Task 11。

- [ ] **Step 1: shared.ts**

`CardDraft` 加 `serviceClass: ServiceClass;`（import type 從 board-model）。`createDraft()` 加 `serviceClass: "standard",`。`draftFromCard` 加 `serviceClass: card.serviceClass,`。`draftToCardInput` 加 `serviceClass: draft.serviceClass,`。新增：

```ts
export const serviceClassText: Record<ServiceClass, string> = {
  standard: "標準",
  expedite: "加急",
  fixedDate: "固定日期",
  intangible: "無形",
};
```

- [ ] **Step 2: CardItem.tsx**

Props 加 `settings: BoardSettings; isDoneColumn: boolean;`。元件內：

```tsx
  const agingDays = isDoneColumn ? 0 : getCardAgingDays(card, today);
  const agingLevel = isDoneColumn ? "normal" : getAgingLevel(agingDays, settings);
```

`<article>` 的 className 改為：

```tsx
      className={`card${card.serviceClass === "expedite" ? " expedite" : ""}`}
```

標題按鈕內、priorityDot 之後加徽章：

```tsx
        {card.serviceClass !== "standard" && (
          <span className={`serviceBadge ${card.serviceClass}`}>
            {serviceClassText[card.serviceClass]}
          </span>
        )}
```

`cardMeta` 區（優先級 span 之後）加：

```tsx
        {!isDoneColumn && (
          <span className={`agingNote ${agingLevel}`}>
            此欄 {agingDays} 天{agingLevel !== "normal" ? " · 停留過久" : ""}
          </span>
        )}
```

- [ ] **Step 3: BoardApp.tsx 傳入 props**

CardItem 呼叫處（約 1026 行附近）加：

```tsx
                      settings={board.settings}
                      isDoneColumn={column.id === DONE_COLUMN_ID}
```

（該 render 迴圈的欄位變數名以檔內實際為準。）

- [ ] **Step 4: DetailModal.tsx**

`formGrid`（優先級／到期日）中加入第三個欄位：

```tsx
            <label className="formField">
              <span>服務類別</span>
              <select
                value={draft.serviceClass}
                onChange={(event) =>
                  setDraft({ serviceClass: event.target.value as ServiceClass })
                }
              >
                <option value="standard">標準</option>
                <option value="expedite">加急</option>
                <option value="fixedDate">固定日期</option>
                <option value="intangible">無形</option>
              </select>
            </label>
```

到期日欄位之後加非阻擋提示：

```tsx
          {draft.serviceClass === "fixedDate" && !draft.dueDate && (
            <small className="fieldHint">固定日期類別建議設定到期日，未設定仍可儲存。</small>
          )}
```

（import `ServiceClass` type 與 `serviceClassText` 視需要。）

- [ ] **Step 5: globals.css**

參考既有 `.blockedBanner`、`.labelPill` 的色彩與變數寫法加入：

```css
.serviceBadge {
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.serviceBadge.expedite { color: var(--danger, #c0392b); font-weight: 700; }
.serviceBadge.fixedDate { color: var(--accent, #5b7cfa); }
.serviceBadge.intangible { color: var(--muted, #6b7280); }

.card.expedite { border: 2px solid var(--danger, #c0392b); }

.agingNote.warn { color: var(--warn, #b7791f); font-weight: 600; }
.agingNote.alert { color: var(--danger, #c0392b); font-weight: 700; }
```

（實際色票 fallback 依 `globals.css` 既有變數命名調整；若無 `--danger` 等變數則沿用檔內逾期文字 `.overdueText` 的既有顏色寫法。）

- [ ] **Step 6: 驗證與 Commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠

```bash
git add app/components/board/shared.ts app/components/board/CardItem.tsx app/components/board/DetailModal.tsx app/components/board/BoardApp.tsx app/globals.css
git commit -m "feat: show card aging and service class on the board"
```

---

### Task 7: 看板統計列加急指標與 Board 設定編輯

**Files:**
- Modify: `app/components/board/BoardApp.tsx`（statsGrid 約 630 行；工作流管理區塊，`columnEditor` 附近）
- Modify: `app/globals.css`（設定列樣式，如需要）

**Interfaces:**
- Consumes: Task 4 的 `stats.expedite`、`updateBoardSettings`、`board.settings`；既有 `access.canConfigureWorkflow`。
- Produces: 無新匯出；純 UI。

此 Task 為 UI 組裝；以 typecheck/build 防護。

- [ ] **Step 1: 統計列**

`statsGrid` 中「逾期」之後加：

```tsx
          <Stat
            label={board.settings.expediteWipLimit === null
              ? "加急"
              : `加急（上限 ${board.settings.expediteWipLimit}）`}
            value={stats.expedite}
            tone={
              board.settings.expediteWipLimit !== null &&
              stats.expedite > board.settings.expediteWipLimit
                ? "danger"
                : "ok"
            }
          />
```

超限時另設 `setLiveMessage`（在造成超限的 updateCard/addCard 動作後檢查前後 expedite 數，超過上限時 `setLiveMessage("加急卡已超過上限，請優先完成加急工作。")`）。實作位置：BoardApp 既有的卡片儲存 handler（`onSubmit` / detail 儲存路徑），比較儲存前後 `getBoardStats(...).expedite` 與 `board.settings.expediteWipLimit`。

- [ ] **Step 2: Board 設定編輯（owner-only）**

在工作流欄位管理區（`access.canConfigureWorkflow` 已 gating 的區塊）尾端加入：

```tsx
              <div className="boardSettingsRow">
                <label>
                  <span>老化警示（天）</span>
                  <input
                    type="number" min={1} max={365}
                    value={board.settings.agingWarnDays}
                    onChange={(event) => setBoard((current) =>
                      updateBoardSettings(current, { agingWarnDays: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  <span>老化嚴重（天）</span>
                  <input
                    type="number" min={1} max={365}
                    value={board.settings.agingAlertDays}
                    onChange={(event) => setBoard((current) =>
                      updateBoardSettings(current, { agingAlertDays: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  <span>加急上限（空白為不限）</span>
                  <input
                    type="number" min={1} max={99}
                    value={board.settings.expediteWipLimit ?? ""}
                    onChange={(event) => setBoard((current) =>
                      updateBoardSettings(current, {
                        expediteWipLimit: event.target.value === ""
                          ? null
                          : Number(event.target.value),
                      }))}
                  />
                </label>
              </div>
```

包在既有工作流管理 UI 的同一權限與離線 guard 下（owner-only、離線管理操作不進 queue 的既有規則由包住它的區塊沿用；確認此區塊確實只在 `access.canConfigureWorkflow` 為 true 時 render）。

- [ ] **Step 3: 驗證與 Commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠

```bash
git add app/components/board/BoardApp.tsx app/globals.css
git commit -m "feat: expedite WIP indicator and board flow settings"
```

---

### Task 8: 流動報表（擴充 MonthlyReportModal）

**Files:**
- Modify: `app/components/board/MonthlyReportModal.tsx`
- Modify: `app/components/board/BoardApp.tsx`（`MonthlyReportModal` 呼叫處約 1095 行，改傳 `getMonthlyFlowStats` 結果）
- Modify: `app/globals.css`（報表新區塊樣式）

**Interfaces:**
- Consumes: Task 4 的 `MonthlyFlowStats`、`getMonthlyFlowStats`、`serviceClassText`（Task 6）。
- Produces: `MonthlyReportModal` 的 `stats` prop 型別改為 `MonthlyFlowStats[]`。

- [ ] **Step 1: 實作**

`MonthlyReportModal` 的 props 改 `stats: MonthlyFlowStats[]`，標題改「📊 流動報表」。每月列（既有長條之後）追加度量行：

```tsx
                    <div className="reportFlowRow">
                      <span>
                        Cycle Time 中位數：
                        {s.cycleTimeMedianDays === null ? "—" : `${s.cycleTimeMedianDays} 天`}
                        {s.cycleTimeAverageDays !== null && `（平均 ${s.cycleTimeAverageDays} 天）`}
                      </span>
                      <span>阻塞：{formatBlockedDuration(s.blockedTotalMs)}</span>
                      <span>
                        流動效率：
                        {s.flowEfficiencyMedian === null
                          ? "—"
                          : `${Math.round(s.flowEfficiencyMedian * 100)}%`}
                      </span>
                      {s.unmeasuredCount > 0 && (
                        <span className="reportUnmeasured">無度量資料 {s.unmeasuredCount} 張</span>
                      )}
                      <span>
                        {(Object.entries(s.serviceClassCounts) as Array<[ServiceClass, number]>)
                          .filter(([, count]) => count > 0)
                          .map(([kind, count]) => `${serviceClassText[kind]} ${count}`)
                          .join("、")}
                      </span>
                    </div>
```

檔內加 helper：

```tsx
function formatBlockedDuration(ms: number): string {
  if (ms <= 0) return "0 小時";
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.round(hours * 10) / 10} 小時`;
  return `${Math.round((hours / 24) * 10) / 10} 天`;
}
```

`BoardApp.tsx`：報表資料來源由 `getMonthlyCompletionStats` 改為 `getMonthlyFlowStats`（import 調整；找到現有計算 `MonthlyCompletion[]` 的 useMemo 或呼叫處直接替換）。

`.reportFlowRow` 樣式仿 `.reportChartRow` 加一行 flex、字級縮小；`.reportUnmeasured` 用 muted 色。

- [ ] **Step 2: 驗證與 Commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全綠

```bash
git add app/components/board/MonthlyReportModal.tsx app/components/board/BoardApp.tsx app/globals.css
git commit -m "feat: extend monthly report into a flow report"
```

---

### Task 9: Worker 驗證與 Activity Log（boards.ts、board-diff.ts）

**Files:**
- Modify: `worker-sync/src/boards.ts`（新增 `requireValidFlowFields`、`preserveBoardSettings`、`settingsSignature`；接入 `putBoardContent`（約 590–612 行）、`createBoard`（約 300 行）、`putLegacyRow`（約 685 行））
- Modify: `worker-sync/src/board-diff.ts`（`CardField`、`CardSnapshot`、parse 與 diff）
- Test: `worker-sync/test/boards.integration.test.ts`（附加）

**Interfaces:**
- Consumes: 既有 `RequestError`、`asRecord`、`requireWorkflowManagement` 呼叫慣例。
- Produces:
  - 錯誤碼 `invalid_flow_fields`（400）、`forbidden`（403，settings 非 owner 變更沿用既有碼）
  - `CardField` 聯集新增 `"serviceClass"`；`CardSnapshot` 新增 `serviceClass: string; startedAt: string | null; blockedMs: number`（Task 10 的報表計算依賴 snapshot 這三個欄位與既有 `blocked`/`blockedAt`）

- [ ] **Step 1: 寫失敗測試**

在 `worker-sync/test/boards.integration.test.ts` 仿照既有 board PUT 測試模式附加（fixture 建立方式、token 與 request helper 依檔內既有寫法；以下描述測試意圖與斷言）：

```ts
// 1. serviceClass 非列舉值 → PUT 回 400 invalid_flow_fields
// 2. blockedMs 為負數或非數字 → 400 invalid_flow_fields
// 3. columnEnteredAt 為 "not-a-date" → 400 invalid_flow_fields
// 4. 完全沒有新欄位的 v6 board payload → 200（舊 client 相容）
// 5. owner 先 PUT 含 settings 的 board；member 再 PUT 一份 settings 值不同的 board → 403
// 6. member PUT「不含 settings」的 board → 200，且 GET 回來的 board 仍保有 owner 設定的 settings
// 7. member 修改卡片 serviceClass → 200，且 Activity Log 的 card.updated fields 含 "serviceClass"
// 8. 只移動卡片（columnEnteredAt/updatedAt 變）→ Log 的 fields 不含 columnEnteredAt/startedAt/blockedMs
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/boards.integration.test.ts`
Expected: 新測試 FAIL

- [ ] **Step 3: 實作 boards.ts**

常數區加：

```ts
const SERVICE_CLASSES = new Set(["standard", "expedite", "fixedDate", "intangible"]);
const MAX_BLOCKED_MS = 100 * 365 * 24 * 3600 * 1000;
```

新函式（放在 `collectAssigneeUserIds` 附近）：

```ts
function isValidTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/** v6 舊 client 相容：欄位缺席即通過，出現才驗格式。 */
function requireValidFlowFields(value: unknown): void {
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return;
  for (const raw of Object.values(cards)) {
    const card = asRecord(raw);
    if (!card) continue;
    if (card.serviceClass !== undefined && !SERVICE_CLASSES.has(card.serviceClass as string)) {
      throw new RequestError(400, "invalid_flow_fields");
    }
    if (card.columnEnteredAt !== undefined && !isValidTimestamp(card.columnEnteredAt)) {
      throw new RequestError(400, "invalid_flow_fields");
    }
    if (
      card.startedAt !== undefined && card.startedAt !== null &&
      !isValidTimestamp(card.startedAt)
    ) {
      throw new RequestError(400, "invalid_flow_fields");
    }
    if (card.blockedMs !== undefined) {
      const blockedMs = card.blockedMs;
      if (
        typeof blockedMs !== "number" || !Number.isFinite(blockedMs) ||
        blockedMs < 0 || blockedMs > MAX_BLOCKED_MS
      ) {
        throw new RequestError(400, "invalid_flow_fields");
      }
    }
  }
}

function settingsSignature(value: unknown): string {
  const settings = asRecord(asRecord(value)?.settings);
  if (!settings) return "absent";
  return JSON.stringify({
    agingWarnDays: settings.agingWarnDays,
    agingAlertDays: settings.agingAlertDays,
    expediteWipLimit: settings.expediteWipLimit,
  });
}

/** 舊 client 送出的 board 沒有 settings 時，保留前一版設定，避免被剝除。 */
function preserveBoardSettings(previousBoard: unknown, nextBoard: unknown): unknown {
  const next = asRecord(nextBoard);
  const previous = asRecord(previousBoard);
  if (!next || next.settings !== undefined || !previous || previous.settings === undefined) {
    return nextBoard;
  }
  return { ...next, settings: previous.settings };
}
```

`requireWorkflowManagement` 加入 settings 檢查（owner=歷史命名 manager 可改，其他人不可）：

```ts
  if (access.projectRole === "manager") return;
  // 既有 workflow signature 檢查之後追加：
  if (settingsSignature(previousBoard) !== settingsSignature(nextBoard)) {
    throw new RequestError(403, "forbidden");
  }
```

`putBoardContent`（`payload` 解析成功後、`requireWorkflowManagement` 之前）：

```ts
  requireValidFlowFields(payload.board);
  const effectiveBoard = preserveBoardSettings(previousBoard, payload.board);
```

之後所有使用 `payload.board` 之處（`requireWorkflowManagement`、`requireSafeWorkflowTransition`、`requireNewAssigneesAreProjectMembers`、`JSON.stringify`、`diffBoardStates`）改用 `effectiveBoard`。

`createBoard`：`parseBoardPutPayload` 檢查之後加 `requireValidFlowFields(body.board);`。

`putLegacyRow`：`parseBoardPutPayload` 成功後加 `requireValidFlowFields(payload.board);`（legacy 單看板無 settings 概念與角色分層，只做欄位格式驗證）。

- [ ] **Step 4: 實作 board-diff.ts**

`CardField` 聯集加 `| "serviceClass"`。`CardSnapshot` 加：

```ts
  serviceClass: string;
  startedAt: string | null;
  blockedMs: number;
```

parse 卡片處（`blockedReason` 附近）加：

```ts
      serviceClass: typeof card.serviceClass === "string" ? card.serviceClass : "standard",
      startedAt: typeof card.startedAt === "string" ? card.startedAt : null,
      blockedMs: Number.isFinite(Number(card.blockedMs)) ? Number(card.blockedMs) : 0,
```

diff 欄位比較處（`blockedReason` 比較之後）加：

```ts
  if (before.serviceClass !== after.serviceClass) fields.push("serviceClass");
```

**不要**為 `columnEnteredAt`、`startedAt`、`blockedMs` 加 diff 比較——規格明確排除（移動與阻塞的衍生時間戳，記 Log 只會製造雜訊）。注意：diff 對 card.updated 的判定若以「任一 snapshot 欄位改變」為準，snapshot 加入 `startedAt`/`blockedMs` 可能讓純移動被誤判為 card.updated——檢查 `diffBoardStates` 的實作，若 fields 為空則不應產生 `card.updated` 事件；必要時把 `startedAt`/`blockedMs` 只放進 snapshot 型別供 reports 使用、不參與 updated 判定。

- [ ] **Step 5: 執行測試確認通過**

Run: `WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/boards.integration.test.ts && pnpm worker:test && pnpm worker:types:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker-sync/src/boards.ts worker-sync/src/board-diff.ts worker-sync/test/boards.integration.test.ts
git commit -m "feat: validate flow fields and guard board settings in worker"
```

---

### Task 10: Worker 流動報表（reports.ts）

**Files:**
- Modify: `worker-sync/src/reports.ts`（`buildProjectSummary`）
- Test: `worker-sync/test/reports.integration.test.ts`（附加）

**Interfaces:**
- Consumes: Task 9 的 `CardSnapshot.serviceClass / startedAt / blockedMs`、既有 `blocked`、`blockedAt`、`completedAt`。
- Produces: summary 的 `monthlyCompletions[]` 每項新增 `cycleTimeMedianDays: number | null`、`cycleTimeAverageDays: number | null`、`unmeasuredCount: number`、`blockedTotalMs: number`、`flowEfficiencyMedian: number | null`、`serviceClassCounts: Record<string, number>`（additive，不移除既有欄位）。計算規則與 client `getMonthlyFlowStats` 一致（Worker 端已完成卡片的進行中阻塞計到 `completedAt`）。

- [ ] **Step 1: 寫失敗測試**

在 `worker-sync/test/reports.integration.test.ts` 仿照既有 summary 測試附加：

```ts
// 1. 建立含一張已完成卡的 board：startedAt=2026-08-01T09:00Z、completedAt=2026-08-03T09:00Z、
//    blockedMs=3600000、serviceClass="expedite"。
//    GET /projects/:id/summary → 當月 entry 的 cycleTimeMedianDays=2、blockedTotalMs=3600000、
//    flowEfficiencyMedian≈0.979（斷言 > 0.97 && < 0.99）、serviceClassCounts.expedite=1。
// 2. 已完成但 startedAt=null 的卡 → unmeasuredCount=1，且不影響 cycleTime 中位數。
// 3. v6 board（卡片無新欄位）→ summary 200，unmeasuredCount 等於完成數、blockedTotalMs=0。
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/reports.integration.test.ts`
Expected: 新測試 FAIL

- [ ] **Step 3: 實作**

`reports.ts` 加 helpers（檔內私有）：

```ts
const DAY_MS = 24 * 3600 * 1000;
const SERVICE_CLASSES = ["standard", "expedite", "fixedDate", "intangible"] as const;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

type MonthlyFlowAccumulator = {
  count: number;
  cycleTimes: number[];
  efficiencies: number[];
  unmeasuredCount: number;
  blockedTotalMs: number;
  serviceClassCounts: Record<string, number>;
};

function emptyAccumulator(): MonthlyFlowAccumulator {
  return {
    count: 0, cycleTimes: [], efficiencies: [], unmeasuredCount: 0, blockedTotalMs: 0,
    serviceClassCounts: Object.fromEntries(SERVICE_CLASSES.map((kind) => [kind, 0])),
  };
}
```

`buildProjectSummary` 中把 `monthlyCounts: Map<string, number>` 改為 `Map<string, MonthlyFlowAccumulator>`。完成卡迴圈改為：

```ts
    for (const card of Object.values(board.cards)) {
      if (!doneIds.has(card.id) || !card.completedAt) continue;
      const month = monthKey(card.completedAt, timeZone);
      const bucket = month ? monthly.get(month) : undefined;
      if (!bucket) continue;
      bucket.count += 1;
      const kind = SERVICE_CLASSES.includes(card.serviceClass as never)
        ? card.serviceClass
        : "standard";
      bucket.serviceClassCounts[kind] += 1;

      const completed = new Date(card.completedAt).getTime();
      let blockedTotal = card.blockedMs;
      if (card.blocked && card.blockedAt) {
        const since = new Date(card.blockedAt).getTime();
        if (Number.isFinite(since) && completed > since) {
          blockedTotal += completed - since;
        }
      }
      bucket.blockedTotalMs += blockedTotal;

      const started = card.startedAt ? new Date(card.startedAt).getTime() : Number.NaN;
      if (!Number.isFinite(started) || completed <= started) {
        bucket.unmeasuredCount += 1;
        continue;
      }
      const cycleMs = completed - started;
      bucket.cycleTimes.push(cycleMs / DAY_MS);
      bucket.efficiencies.push(Math.min(Math.max((cycleMs - blockedTotal) / cycleMs, 0), 1));
    }
```

`monthlyCompletions` 輸出改為：

```ts
    monthlyCompletions: months.map((month) => {
      const bucket = monthly.get(month) ?? emptyAccumulator();
      return {
        month,
        monthLabel: `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`,
        count: bucket.count,
        cycleTimeMedianDays: roundOrNull(median(bucket.cycleTimes)),
        cycleTimeAverageDays: roundOrNull(
          bucket.cycleTimes.length
            ? bucket.cycleTimes.reduce((sum, value) => sum + value, 0) / bucket.cycleTimes.length
            : null,
        ),
        unmeasuredCount: bucket.unmeasuredCount,
        blockedTotalMs: bucket.blockedTotalMs,
        flowEfficiencyMedian: median(bucket.efficiencies),
        serviceClassCounts: bucket.serviceClassCounts,
      };
    }),
```

- [ ] **Step 4: 執行測試確認通過**

Run: `WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/reports.integration.test.ts && pnpm worker:test`
Expected: PASS（既有 summary 測試為 additive 欄位不應壞；若有嚴格 shape 斷言，更新之）

- [ ] **Step 5: Commit**

```bash
git add worker-sync/src/reports.ts worker-sync/test/reports.integration.test.ts
git commit -m "feat: add flow metrics to project summary"
```

---

### Task 11: 文件、已知限制與完整品質關卡

**Files:**
- Modify: `README.md`（功能清單加流動度量與服務類別；「Project／Board 與同步行為」加 blockedMs LWW 已知限制）
- Modify: `NextTasks.md`（「目前真實狀態」表格加一列；P0-4 人工驗收清單加流動度量／加急項目）

**Interfaces:** 無程式碼。

- [ ] **Step 1: README.md**

功能清單加：

```markdown
- 卡片欄位停留老化、Cycle Time／阻塞時長／流動效率流動報表、服務類別與加急 WIP 上限。
```

「Project／Board 與同步行為」清單加：

```markdown
- 卡片阻塞累計時長（blockedMs）在多裝置併發編輯時取最後寫入者，可能少算一段阻塞時間；
  這是為了維持卡片級 LWW 合併簡單性所接受的精度損失。
```

- [ ] **Step 2: NextTasks.md**

「目前真實狀態」表格加：

```markdown
| 流動度量與服務類別 v1 | 已完成實作，待 staging 驗收 | Card schema v7：欄位進入／開工時間、累計阻塞、服務類別與加急 WIP；卡面老化與流動報表；Worker 驗證與 summary 流動度量 |
```

P0-4「多專案與權限」或適當小節附加人工驗收項目：

```markdown
- [ ] 卡片跨欄移動後老化天數歸零；同欄重排不歸零。
- [ ] v6 舊資料升級後報表顯示「無度量資料」，`completedAt` 未變。
- [ ] member 可改服務類別；member 不能改老化門檻與加急上限（Worker 403）。
- [ ] 舊版 client（無 settings payload）儲存看板不會清掉 owner 設定。
- [ ] 加急卡在桌面與 Mobile 都固定排在欄位前段；超過上限時警告不阻擋。
- [ ] 雙裝置的 Cycle Time／阻塞時長在同步收斂後一致。
```

- [ ] **Step 3: 完整品質關卡**

```bash
pnpm test
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
pnpm worker:types:check
pnpm sync:dry-run
git diff --check
```

Expected: 全部通過。

- [ ] **Step 4: Commit**

```bash
git add README.md NextTasks.md
git commit -m "docs: record flow metrics and service class v1"
```

---

## Self-Review 紀錄

- 規格覆蓋：§2.1 欄位（Task 1–2）、§2.2 settings（Task 1、4、7、9）、§2.3 加急不變量（Task 3）、§2.4 篩選（Task 5）、§3 度量定義（Task 4、10）、§4.1–4.4 UI（Task 6–8）、§5 權限（Task 7 UI gating、Task 9 Worker 強制）、§6 同步稽核（Task 9）、§7 migration（Task 1）、§8 測試（各 Task）、README 已知限制（Task 11）。
- 型別一致性：`ServiceClass`／`BoardSettings`／`MonthlyFlowStats`／`getMonthlyFlowStats`／`updateBoardSettings`／`requireValidFlowFields` 名稱在各 Task 間一致。
- 已知的執行時注意事項寫在對應 Task 內（moveCard `completedAt` 語意保持、diff 誤判 card.updated 的檢查點、既有 summary 測試 shape）。
