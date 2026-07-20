# 階段 3a：看板雲端同步 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全團隊共用的看板經獨立 Cloudflare Worker（D1 + Bearer token）跨裝置同步，離線優先、revision 衝突以卡片級 LWW 合併。

**Architecture:** 新增 `worker-sync/` 獨立 Worker（單一共用看板存 D1 單列：revision 整數 + JSON 文件；users 表存 token 雜湊）。客戶端新增 `app/sync/`：純函式合併器（墓碑防刪除復活，schema v3）、fetch API 層、`useSync` hook（啟動拉取、變更 debounce 推送、409 → 合併 → 重推、前景觸發）；UI 為 topBar 同步狀態 pill + 設定對話框。本地（localStorage）仍是第一落點，離線完全可用。

**Tech Stack:** 既有棧 + Cloudflare Workers/D1（`wrangler` 已在 devDependencies，**不新增任何 npm 依賴**）。

**對應 spec:** `docs/superpowers/specs/2026-07-14-mobile-app-design.md` 第 6 節（部署/認證/同步模型）、第 7 節（錯誤處理）、第 8 節（測試）。附件流（spec 6 之附件流與 R2）屬 **3b**，本計畫不含 — 過渡期其他裝置對未同步的附件顯示既有「附件載入失敗」占位，屬已知暫態。

**Spec 落差聲明（設計深化，非偏離）：**
- spec 未定「刪除卡片在 LWW 下會被舊資料復活」的問題 → 本計畫引入**墓碑**（`deletedCards: Record<cardId, deletedAtISO>`，schema v3，30 天後修剪）。
- spec 寫「app 用 Capacitor Preferences/Filesystem」存本地資料 → 實測 WKWebView localStorage 已於實機驗證持久（階段 1 判別性證據），維持 localStorage，不引入新插件。
- 共用模式經使用者決策（2026-07-20）：全團隊單一看板。

## Global Constraints

- 套件管理 `pnpm`；**不新增任何 npm 依賴**（Worker 用原生 fetch handler，型別自帶最小宣告）。
- 每個 task 結尾必須通過：`pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`。
- 所有使用者可見文案繁體中文；同步失敗一律可見、可重試，**絕不把未成功的寫入顯示為已同步**；token 無效（401）提示重新設定 token，本地資料不受影響。
- `STORAGE_KEY` 不變；新增 localStorage 鍵：`kanban-sync-config-v1`（`{baseUrl, token}`）、`kanban-sync-revision-v1`（整數字串）。
- TypeScript strict；不新增 `any`。Commit 訊息：祈使句、無 conventional-commit 前綴。
- Task 6（部署）前置：使用者已執行 `npx wrangler login`（Task 6 Step 1 以 `whoami` 驗證，未登入即停下回報）。

---

### Task 1: Schema v3 — 刪除墓碑

**Files:**
- Modify: `app/board-model.ts`
- Test: `tests/board-tombstones.test.ts`（新建）

**Interfaces:**
- Produces:
  - `BoardState` 增加 `deletedCards: Record<string, string>`（cardId → 刪除時間 ISO）
  - `BOARD_SCHEMA_VERSION = 3`；`parsePersistedBoard` 接受 1、2、3
  - `deleteCard` 記墓碑；`addCard` 對同 id 清墓碑
  - `export const TOMBSTONE_TTL_DAYS = 30`；`normalizeBoard` 修剪逾期墓碑與「卡片仍存在」的墓碑

- [ ] **Step 1: 寫失敗測試**

建立 `tests/board-tombstones.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  addCard,
  createDemoBoard,
  deleteCard,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
} from "../app/board-model";

test("schema 版本為 3 且示範看板墓碑為空", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 3);
  assert.deepEqual(createDemoBoard(new Date(2026, 6, 20)).deletedCards, {});
});

test("刪除卡片會記墓碑，重加同 id 會清墓碑", () => {
  const board = createDemoBoard(new Date(2026, 6, 20));
  const deleted = deleteCard(board, "card-roadmap");
  assert.equal(typeof deleted.deletedCards["card-roadmap"], "string");
  assert.equal(deleted.cards["card-roadmap"], undefined);

  const revived = addCard(deleted, "todo", { id: "card-roadmap", title: "重生" });
  assert.equal(revived.deletedCards["card-roadmap"], undefined);
  assert.equal(revived.cards["card-roadmap"].title, "重生");
});

test("v2 資料無錯遷移為 v3，補上空墓碑", () => {
  const v2 = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 20))));
  v2.version = 2;
  delete v2.deletedCards;
  const parsed = parsePersistedBoard(JSON.stringify(v2));
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 3);
  assert.deepEqual(parsed.board.deletedCards, {});
});

test("normalizeBoard 修剪逾期墓碑與卡片仍存在的墓碑", () => {
  const board = createDemoBoard(new Date(2026, 6, 20));
  const recent = new Date().toISOString();
  const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const dirty = {
    ...board,
    deletedCards: {
      "card-gone": recent,
      "card-ancient": stale,
      "card-roadmap": recent,
      "card-bad": 123 as unknown as string,
    },
  };
  const normalized = normalizeBoard(dirty);
  assert.deepEqual(Object.keys(normalized.deletedCards), ["card-gone"]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test`
Expected: FAIL — `deletedCards` 不存在、版本仍為 2

- [ ] **Step 3: 修改 `app/board-model.ts`**

1. `export const BOARD_SCHEMA_VERSION = 3;`
2. `BoardState` 在 `labels: Label[];` 後加 `deletedCards: Record<string, string>;`
3. 新增常數（`STORAGE_KEY` 旁）：`export const TOMBSTONE_TTL_DAYS = 30;`
4. `createDemoBoard` 回傳物件加 `deletedCards: {},`
5. `deleteCard` 的 `delete next.cards[cardId];` 後加：

```ts
  next.deletedCards = { ...next.deletedCards, [cardId]: new Date().toISOString() };
```

6. `addCard` 在 `next.cards[id] = card;` 後加：

```ts
  if (next.deletedCards[id]) {
    const cleaned = { ...next.deletedCards };
    delete cleaned[id];
    next.deletedCards = cleaned;
  }
```

7. `parsePersistedBoard` 版本檢查改為：

```ts
    if (!isBoardLike(parsed) || (version !== 1 && version !== 2 && version !== BOARD_SCHEMA_VERSION)) {
```

8. `normalizeBoard` 回傳物件加 `deletedCards: normalizeDeletedCards(board.deletedCards, cards),`
9. `cloneBoard` 回傳物件加 `deletedCards: { ...board.deletedCards },`
10. 新增私有函式（`normalizeAttachments` 後）：

```ts
function normalizeDeletedCards(
  value: unknown,
  cards: Record<string, Card>,
): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result: Record<string, string> = {};
  for (const [cardId, deletedAt] of Object.entries(value as Record<string, unknown>)) {
    if (typeof deletedAt !== "string" || !deletedAt || cards[cardId] || deletedAt < cutoff) {
      continue;
    }
    result[cardId] = deletedAt;
  }
  return result;
}
```

- [ ] **Step 4: 測試通過 + 全面驗證**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過（27 tests）

- [ ] **Step 5: Commit**

```bash
git add app/board-model.ts tests/board-tombstones.test.ts
git commit -m "Add deletion tombstones to board schema v3"
```

---

### Task 2: 合併器 — `app/sync/merge.ts`

**Files:**
- Create: `app/sync/merge.ts`
- Test: `tests/sync-merge.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `deletedCards`、`normalizeBoard`、board 型別。
- Produces: `export function mergeBoards(local: BoardState, remote: BoardState): BoardState` — 卡片級 `updatedAt` LWW；墓碑時間 ≥ 卡片 `updatedAt` 則刪除獲勝，反之卡片復活並清墓碑；欄位結構（標題/WIP/排序）以 `lastSavedAt` 較新一方為準，倖存卡不在其中時放回另一方所在欄（無則第一欄）；輸出經 `normalizeBoard`。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/sync-merge.test.ts`：

```ts
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test`
Expected: FAIL — `app/sync/merge` 不存在

- [ ] **Step 3: 建立 `app/sync/merge.ts`**

```ts
import {
  BOARD_SCHEMA_VERSION,
  type BoardState,
  type Card,
  type Column,
  normalizeBoard,
} from "../board-model";

export function mergeBoards(local: BoardState, remote: BoardState): BoardState {
  const localWins = (local.lastSavedAt || "") >= (remote.lastSavedAt || "");
  const winner = localWins ? local : remote;
  const loser = localWins ? remote : local;

  const deletedCards: Record<string, string> = { ...loser.deletedCards };
  for (const [cardId, deletedAt] of Object.entries(winner.deletedCards)) {
    if (!deletedCards[cardId] || deletedCards[cardId] < deletedAt) {
      deletedCards[cardId] = deletedAt;
    }
  }

  const cards: Record<string, Card> = {};
  const allIds = new Set([...Object.keys(local.cards), ...Object.keys(remote.cards)]);
  for (const cardId of allIds) {
    const mine = local.cards[cardId];
    const theirs = remote.cards[cardId];
    const candidate =
      !mine ? theirs : !theirs ? mine : mine.updatedAt >= theirs.updatedAt ? mine : theirs;
    const tombstone = deletedCards[cardId];
    if (tombstone && tombstone >= candidate.updatedAt) {
      continue;
    }
    if (tombstone) {
      delete deletedCards[cardId];
    }
    cards[cardId] = candidate;
  }

  const columns: Column[] = winner.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((cardId) => cards[cardId]),
  }));
  const placed = new Set(columns.flatMap((column) => column.cardIds));
  for (const cardId of Object.keys(cards)) {
    if (placed.has(cardId)) {
      continue;
    }
    const loserColumn = loser.columns.find((column) => column.cardIds.includes(cardId));
    const target =
      (loserColumn && columns.find((column) => column.id === loserColumn.id)) ?? columns[0];
    target.cardIds.push(cardId);
    placed.add(cardId);
  }

  return normalizeBoard({
    version: BOARD_SCHEMA_VERSION,
    labels: winner.labels,
    cards,
    columns,
    deletedCards,
    lastSavedAt: winner.lastSavedAt >= loser.lastSavedAt ? winner.lastSavedAt : loser.lastSavedAt,
  });
}
```

- [ ] **Step 4: 測試通過 + 全面驗證**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add app/sync/merge.ts tests/sync-merge.test.ts
git commit -m "Add tombstone-aware board merge for sync"
```

---

### Task 3: worker-sync — 同步 API

**Files:**
- Create: `worker-sync/wrangler.jsonc`
- Create: `worker-sync/migrations/0001_init.sql`
- Create: `worker-sync/src/d1.ts`（最小 D1 型別，避免新依賴與全域衝突）
- Create: `worker-sync/src/logic.ts`（純函式）
- Create: `worker-sync/src/index.ts`（fetch handler）
- Modify: `package.json`（scripts：`sync:dev`、`sync:deploy`、`sync:migrate`）
- Test: `tests/worker-sync-logic.test.ts`（新建）

**Interfaces:**
- Produces（HTTP API，Task 4 消費）:
  - 全部端點需 `Authorization: Bearer <token>`；驗證失敗一律 `401 {"error":"unauthorized"}`
  - `GET /board` → `200 {revision, board}` | `404 {"error":"empty"}`
  - `PUT /board` body `{baseRevision, board}` → `200 {revision}`；revision 不符 → `409 {revision, board}`；空庫時 `baseRevision` 必須為 0（create → revision 1）
  - CORS：`*`、允許 `Authorization`/`Content-Type`、處理 OPTIONS
- Produces（純函式）: `sha256Hex(input: string): Promise<string>`、`decideBoardPut(current: number | null, baseRevision: number): PutDecision`、`isBoardPayload(value: unknown): boolean`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/worker-sync-logic.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { decideBoardPut, isBoardPayload, sha256Hex } from "../worker-sync/src/logic";

test("sha256Hex 產生穩定的 64 字元十六進位雜湊", async () => {
  const hash = await sha256Hex("test-token");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await sha256Hex("test-token"));
  assert.notEqual(hash, await sha256Hex("other-token"));
});

test("decideBoardPut：空庫 base 0 建立、有庫 base 相符更新、其餘衝突", () => {
  assert.deepEqual(decideBoardPut(null, 0), { kind: "create" });
  assert.deepEqual(decideBoardPut(null, 3), { kind: "conflict" });
  assert.deepEqual(decideBoardPut(7, 7), { kind: "update", nextRevision: 8 });
  assert.deepEqual(decideBoardPut(7, 6), { kind: "conflict" });
  assert.deepEqual(decideBoardPut(7, 8), { kind: "conflict" });
});

test("isBoardPayload 過濾非看板形狀", () => {
  assert.equal(isBoardPayload({ columns: [], cards: {} }), true);
  assert.equal(isBoardPayload({ columns: {}, cards: {} }), false);
  assert.equal(isBoardPayload(null), false);
  assert.equal(isBoardPayload("x"), false);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test`
Expected: FAIL — 模組不存在

- [ ] **Step 3: 建立 `worker-sync/src/logic.ts`**

```ts
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type PutDecision =
  | { kind: "create" }
  | { kind: "update"; nextRevision: number }
  | { kind: "conflict" };

export function decideBoardPut(current: number | null, baseRevision: number): PutDecision {
  if (current === null) {
    return baseRevision === 0 ? { kind: "create" } : { kind: "conflict" };
  }
  return baseRevision === current
    ? { kind: "update", nextRevision: current + 1 }
    : { kind: "conflict" };
}

export function isBoardPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const board = value as { columns?: unknown; cards?: unknown };
  return Array.isArray(board.columns) && typeof board.cards === "object" && board.cards !== null;
}
```

- [ ] **Step 4: 測試通過**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 建立 `worker-sync/src/d1.ts`**

```ts
// 最小 D1 型別宣告：避免引入 @cloudflare/workers-types 依賴，
// 也避免與 worker/types.d.ts 的全域宣告衝突（此處為模組作用域）。
export type D1Row = Record<string, unknown>;

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = D1Row>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
```

- [ ] **Step 6: 建立 `worker-sync/src/index.ts`**

```ts
import type { D1Database } from "./d1";
import { decideBoardPut, isBoardPayload, sha256Hex } from "./logic";

interface Env {
  DB: D1Database;
}

const MAX_BOARD_BYTES = 1_000_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function authenticate(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return false;
  }
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT id FROM users WHERE token_hash = ?").bind(hash).first();
  return row !== null;
}

type BoardRow = { revision: number; data: string };

async function readBoard(env: Env): Promise<BoardRow | null> {
  return env.DB.prepare("SELECT revision, data FROM board WHERE id = 1").first<BoardRow>();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!(await authenticate(request, env))) {
      return json(401, { error: "unauthorized" });
    }

    const url = new URL(request.url);

    if (url.pathname === "/board" && request.method === "GET") {
      const row = await readBoard(env);
      if (!row) {
        return json(404, { error: "empty" });
      }
      return json(200, { revision: row.revision, board: JSON.parse(row.data) });
    }

    if (url.pathname === "/board" && request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_BOARD_BYTES) {
        return json(413, { error: "board too large" });
      }
      let payload: { baseRevision?: unknown; board?: unknown };
      try {
        payload = JSON.parse(text);
      } catch {
        return json(400, { error: "invalid json" });
      }
      const baseRevision = Number(payload.baseRevision);
      if (!Number.isInteger(baseRevision) || baseRevision < 0 || !isBoardPayload(payload.board)) {
        return json(400, { error: "invalid payload" });
      }

      const row = await readBoard(env);
      const decision = decideBoardPut(row ? row.revision : null, baseRevision);
      if (decision.kind === "conflict") {
        return row
          ? json(409, { revision: row.revision, board: JSON.parse(row.data) })
          : json(409, { revision: 0, board: null });
      }

      const now = new Date().toISOString();
      const data = JSON.stringify(payload.board);
      if (decision.kind === "create") {
        await env.DB.prepare(
          "INSERT INTO board (id, revision, data, updated_at) VALUES (1, 1, ?, ?)",
        )
          .bind(data, now)
          .run();
        return json(200, { revision: 1 });
      }

      const result = await env.DB.prepare(
        "UPDATE board SET revision = ?, data = ?, updated_at = ? WHERE id = 1 AND revision = ?",
      )
        .bind(decision.nextRevision, data, now, baseRevision)
        .run();
      if (!result.meta.changes) {
        const fresh = await readBoard(env);
        return fresh
          ? json(409, { revision: fresh.revision, board: JSON.parse(fresh.data) })
          : json(409, { revision: 0, board: null });
      }
      return json(200, { revision: decision.nextRevision });
    }

    return json(404, { error: "not found" });
  },
};
```

（條件式 `UPDATE ... AND revision = ?` 防兩個 Worker 實例併發寫入的 lost update。）

- [ ] **Step 7: 建立 migration 與 wrangler 設定**

`worker-sync/migrations/0001_init.sql`：

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE board (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`worker-sync/wrangler.jsonc`：

```jsonc
{
  "name": "kanban-sync",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "kanban-sync",
      "database_id": "TO-BE-SET-BY-DEPLOY-TASK"
    }
  ]
}
```

`package.json` scripts 加：

```json
"sync:dev": "wrangler dev -c worker-sync/wrangler.jsonc",
"sync:migrate": "wrangler d1 migrations apply kanban-sync --remote -c worker-sync/wrangler.jsonc",
"sync:deploy": "wrangler deploy -c worker-sync/wrangler.jsonc",
```

- [ ] **Step 8: 全面驗證**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過（worker-sync 為獨立目錄，web/mobile 建置不受影響；`pnpm typecheck` 涵蓋 worker-sync/src）

- [ ] **Step 9: Commit**

```bash
git add worker-sync/ tests/worker-sync-logic.test.ts package.json
git commit -m "Add sync worker with token auth and revisioned board endpoint"
```

---

### Task 4: 客戶端同步引擎 — `app/sync/`

**Files:**
- Create: `app/sync/api.ts`
- Create: `app/sync/config.ts`
- Create: `app/sync/useSync.ts`
- Test: `tests/sync-config.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 `mergeBoards`；Task 3 HTTP API。
- Produces:
  - `type SyncConfig = { baseUrl: string; token: string }`
  - `config.ts`：`loadSyncConfig(): SyncConfig | null`、`saveSyncConfig(config: SyncConfig | null): void`、`loadSyncRevision(): number`、`saveSyncRevision(revision: number): void`、`normalizeBaseUrl(input: string): string`（trim、去尾斜線、必須 http/https 否則丟 Error）
  - `api.ts`：`fetchRemoteBoard(config): Promise<{revision: number; board: unknown} | null>`（404 → null）、`pushRemoteBoard(config, baseRevision, board): Promise<{kind:"ok";revision:number} | {kind:"conflict";revision:number;board:unknown}>`、`class SyncApiError extends Error { status: number }`
  - `useSync.ts`：`useSync(board: BoardState, setBoard: Dispatch<SetStateAction<BoardState>>, loaded: boolean): SyncHandle`，其中

```ts
export type SyncStatus = "disabled" | "pending" | "syncing" | "synced" | "error";
export type SyncHandle = {
  status: SyncStatus;
  errorMessage: string;
  configured: boolean;
  syncNow: () => void;
  enable: (config: SyncConfig, initialMode: "download" | "merge") => Promise<void>;
  disable: () => void;
};
```

- [ ] **Step 1: 寫失敗測試（config 純函式）**

建立 `tests/sync-config.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBaseUrl } from "../app/sync/config";

test("normalizeBaseUrl 修剪空白與尾斜線", () => {
  assert.equal(normalizeBaseUrl(" https://sync.example.com/ "), "https://sync.example.com");
  assert.equal(normalizeBaseUrl("https://sync.example.com/api/"), "https://sync.example.com/api");
  assert.equal(normalizeBaseUrl("http://localhost:8787"), "http://localhost:8787");
});

test("normalizeBaseUrl 拒絕非 http(s) 或空值", () => {
  assert.throws(() => normalizeBaseUrl(""));
  assert.throws(() => normalizeBaseUrl("ftp://x"));
  assert.throws(() => normalizeBaseUrl("not-a-url"));
});
```

Run: `pnpm test` → Expected: FAIL

- [ ] **Step 2: 建立 `app/sync/config.ts`**

```ts
export type SyncConfig = { baseUrl: string; token: string };

const CONFIG_KEY = "kanban-sync-config-v1";
const REVISION_KEY = "kanban-sync-revision-v1";

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("同步伺服器網址格式不正確。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("同步伺服器網址必須是 http(s)。");
  }
  return trimmed;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string" || !parsed.baseUrl || !parsed.token) {
      return null;
    }
    return { baseUrl: parsed.baseUrl, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig | null): void {
  if (config) {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } else {
    window.localStorage.removeItem(CONFIG_KEY);
    window.localStorage.removeItem(REVISION_KEY);
  }
}

export function loadSyncRevision(): number {
  const raw = window.localStorage.getItem(REVISION_KEY);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function saveSyncRevision(revision: number): void {
  window.localStorage.setItem(REVISION_KEY, String(revision));
}
```

- [ ] **Step 3: 建立 `app/sync/api.ts`**

```ts
import type { SyncConfig } from "./config";

export class SyncApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SyncApiError";
    this.status = status;
  }
}

function authHeaders(config: SyncConfig): HeadersInit {
  return { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
}

export async function fetchRemoteBoard(
  config: SyncConfig,
): Promise<{ revision: number; board: unknown } | null> {
  const response = await fetch(`${config.baseUrl}/board`, { headers: authHeaders(config) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new SyncApiError(response.status, `GET /board 失敗（${response.status}）`);
  }
  return (await response.json()) as { revision: number; board: unknown };
}

export type PushResult =
  | { kind: "ok"; revision: number }
  | { kind: "conflict"; revision: number; board: unknown };

export async function pushRemoteBoard(
  config: SyncConfig,
  baseRevision: number,
  board: unknown,
): Promise<PushResult> {
  const response = await fetch(`${config.baseUrl}/board`, {
    method: "PUT",
    headers: authHeaders(config),
    body: JSON.stringify({ baseRevision, board }),
  });
  if (response.status === 409) {
    const body = (await response.json()) as { revision: number; board: unknown };
    return { kind: "conflict", revision: body.revision, board: body.board };
  }
  if (!response.ok) {
    throw new SyncApiError(response.status, `PUT /board 失敗（${response.status}）`);
  }
  const body = (await response.json()) as { revision: number };
  return { kind: "ok", revision: body.revision };
}
```

- [ ] **Step 4: 建立 `app/sync/useSync.ts`**

```ts
"use client";

import {
  BOARD_SCHEMA_VERSION,
  type BoardState,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
} from "../board-model";
import { type PushResult, SyncApiError, fetchRemoteBoard, pushRemoteBoard } from "./api";
import {
  type SyncConfig,
  loadSyncConfig,
  loadSyncRevision,
  saveSyncConfig,
  saveSyncRevision,
} from "./config";
import { mergeBoards } from "./merge";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type SyncStatus = "disabled" | "pending" | "syncing" | "synced" | "error";

export type SyncHandle = {
  status: SyncStatus;
  errorMessage: string;
  configured: boolean;
  syncNow: () => void;
  enable: (config: SyncConfig, initialMode: "download" | "merge") => Promise<void>;
  disable: () => void;
};

const DEBOUNCE_MS = 2000;
const MAX_CONFLICT_ROUNDS = 3;

function toBoardState(value: unknown): BoardState {
  // 遠端資料視同不可信持久化資料，走同一套防呆解析
  return parsePersistedBoard(JSON.stringify(value)).board;
}

export function useSync(
  board: BoardState,
  setBoard: Dispatch<SetStateAction<BoardState>>,
  loaded: boolean,
): SyncHandle {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>("disabled");
  const [errorMessage, setErrorMessage] = useState("");
  const boardRef = useRef(board);
  const configRef = useRef<SyncConfig | null>(null);
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef("");

  boardRef.current = board;
  configRef.current = config;

  const runSync = useCallback(async () => {
    const active = configRef.current;
    if (!active) {
      return;
    }
    if (busyRef.current) {
      queuedRef.current = true;
      return;
    }
    busyRef.current = true;
    setStatus("syncing");
    setErrorMessage("");
    try {
      let baseRevision = loadSyncRevision();
      let candidate = boardRef.current;
      for (let round = 0; round <= MAX_CONFLICT_ROUNDS; round += 1) {
        const result: PushResult = await pushRemoteBoard(active, baseRevision, candidate);
        if (result.kind === "ok") {
          saveSyncRevision(result.revision);
          lastPushedRef.current = serializeBoard(candidate);
          setStatus("synced");
          busyRef.current = false;
          if (queuedRef.current) {
            queuedRef.current = false;
            void runSync();
          }
          return;
        }
        if (result.board === null) {
          baseRevision = 0;
          continue;
        }
        const merged = mergeBoards(boardRef.current, toBoardState(result.board));
        baseRevision = result.revision;
        candidate = merged;
        setBoard(merged);
      }
      throw new SyncApiError(409, "同步衝突重試次數過多，請稍後再試。");
    } catch (error) {
      busyRef.current = false;
      queuedRef.current = false;
      setStatus("error");
      if (error instanceof SyncApiError && error.status === 401) {
        setErrorMessage("同步憑證無效，請重新設定 token。本機資料不受影響。");
      } else if (error instanceof SyncApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("無法連線到同步伺服器，離線變更會保留在本機。");
      }
    }
  }, [setBoard]);

  // 啟動載入設定 + 初次拉取
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const stored = loadSyncConfig();
    if (!stored) {
      return;
    }
    setConfig(stored);
    configRef.current = stored;
    void (async () => {
      setStatus("syncing");
      try {
        const remote = await fetchRemoteBoard(stored);
        if (remote) {
          const merged = mergeBoards(boardRef.current, toBoardState(remote.board));
          saveSyncRevision(remote.revision);
          setBoard(merged);
        }
        await runSync();
      } catch {
        setStatus("error");
        setErrorMessage("啟動同步失敗，將於下次變更或手動重試時再試。");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 看板變更 → debounce 推送
  useEffect(() => {
    if (!config || !loaded) {
      return;
    }
    if (serializeBoard(board) === lastPushedRef.current) {
      return;
    }
    setStatus((current) => (current === "syncing" ? current : "pending"));
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void runSync();
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [board, config, loaded, runSync]);

  // 回到前景 → 立即同步
  useEffect(() => {
    if (!config) {
      return;
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [config, runSync]);

  const enable = useCallback(
    async (next: SyncConfig, initialMode: "download" | "merge") => {
      saveSyncConfig(next);
      setConfig(next);
      configRef.current = next;
      setStatus("syncing");
      setErrorMessage("");
      try {
        const remote = await fetchRemoteBoard(next);
        if (remote) {
          const base =
            initialMode === "download"
              ? toBoardState(remote.board)
              : mergeBoards(boardRef.current, toBoardState(remote.board));
          saveSyncRevision(remote.revision);
          setBoard(base);
        } else {
          saveSyncRevision(0);
        }
        await runSync();
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof SyncApiError && error.status === 401
            ? "token 無效，請確認後重新輸入。"
            : "無法連線到同步伺服器，請確認網址與網路。",
        );
      }
    },
    [runSync, setBoard],
  );

  const disable = useCallback(() => {
    saveSyncConfig(null);
    setConfig(null);
    configRef.current = null;
    setStatus("disabled");
    setErrorMessage("");
  }, []);

  const syncNow = useCallback(() => {
    void runSync();
  }, [runSync]);

  return { status, errorMessage, configured: config !== null, syncNow, enable, disable };
}
```

（`BOARD_SCHEMA_VERSION` import 若未使用則移除 — 以實際程式碼為準。注意 `toBoardState` 借用 `parsePersistedBoard` 的防呆與遷移，遠端老版本資料也能安全解析。）

- [ ] **Step 5: 全面驗證**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過（useSync 尚無呼叫者，行為不變）

- [ ] **Step 6: Commit**

```bash
git add app/sync/ tests/sync-config.test.ts
git commit -m "Add client sync engine with conflict merge loop"
```

---

### Task 5: 同步 UI — 狀態 pill 與設定對話框

**Files:**
- Create: `app/components/board/SyncSettingsModal.tsx`
- Modify: `app/components/board/BoardApp.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 4 `useSync`、`SyncHandle`、`normalizeBaseUrl`。
- Produces: `SyncSettingsModal({ sync, onClose, modalRef }: { sync: SyncHandle; onClose: () => void; modalRef: RefObject<HTMLDivElement | null> })`。

- [ ] **Step 1: 建立 `app/components/board/SyncSettingsModal.tsx`**

```tsx
"use client";

import { normalizeBaseUrl } from "../../sync/config";
import type { SyncHandle } from "../../sync/useSync";
import { useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

const statusText: Record<SyncHandle["status"], string> = {
  disabled: "未啟用",
  pending: "有變更待同步",
  syncing: "同步中…",
  synced: "已同步",
  error: "同步失敗",
};

export function SyncSettingsModal({
  sync,
  onClose,
  modalRef,
}: {
  sync: SyncHandle;
  onClose: () => void;
  modalRef: RefObject<HTMLDivElement | null>;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [initialMode, setInitialMode] = useState<"download" | "merge">("download");
  const [formError, setFormError] = useState("");

  async function submitEnable() {
    try {
      const normalized = normalizeBaseUrl(baseUrl);
      if (!token.trim()) {
        setFormError("請輸入 token。");
        return;
      }
      setFormError("");
      await sync.enable({ baseUrl: normalized, token: token.trim() }, initialMode);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "設定失敗，請再試一次。");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="syncTitle"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="modalHeader">
          <h2 id="syncTitle">雲端同步設定</h2>
          <button type="button" className="iconOnly" aria-label="關閉" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="syncStatusLine">
          目前狀態：{statusText[sync.status]}
          {sync.errorMessage && <span className="syncErrorText">（{sync.errorMessage}）</span>}
        </p>

        {sync.configured ? (
          <div className="syncActions">
            <button type="button" className="primaryButton" onClick={sync.syncNow}>
              立即同步
            </button>
            <button type="button" className="dangerGhost" onClick={sync.disable}>
              停用同步（保留本機資料）
            </button>
          </div>
        ) : (
          <div className="syncForm">
            <label className="formField">
              <span>同步伺服器網址</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://kanban-sync.example.workers.dev"
                autoFocus
              />
            </label>
            <label className="formField">
              <span>Token</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <fieldset className="fieldGroup">
              <legend>首次同步資料來源</legend>
              <label className="syncModeChoice">
                <input
                  type="radio"
                  name="initialMode"
                  checked={initialMode === "download"}
                  onChange={() => setInitialMode("download")}
                />
                <span>以遠端為準（捨棄本機看板）</span>
              </label>
              <label className="syncModeChoice">
                <input
                  type="radio"
                  name="initialMode"
                  checked={initialMode === "merge"}
                  onChange={() => setInitialMode("merge")}
                />
                <span>合併本機與遠端</span>
              </label>
            </fieldset>
            {formError && (
              <p className="attachmentError" role="alert">
                {formError}
              </p>
            )}
            <div className="modalActions">
              <button type="button" className="secondaryButton" onClick={onClose}>
                取消
              </button>
              <button type="button" className="primaryButton" onClick={() => void submitEnable()}>
                啟用同步
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `BoardApp.tsx` 整合**

1. 檔頭加：

```ts
import { SyncSettingsModal } from "./SyncSettingsModal";
import { useSync } from "../../sync/useSync";
```

2. 狀態區（`loaded` 宣告之後）加：

```tsx
  const sync = useSync(board, setBoard, loaded);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
```

3. topBar 的 `statsGrid` 區塊後加同步 pill（`section className="topBar"` 內）：

```tsx
        <button
          type="button"
          className={`syncPill ${sync.status}`}
          onClick={() => setSyncModalOpen(true)}
          aria-label="開啟雲端同步設定"
        >
          {sync.status === "disabled" && "同步：未啟用"}
          {sync.status === "pending" && "同步：待同步"}
          {sync.status === "syncing" && "同步中…"}
          {sync.status === "synced" && "同步：已同步"}
          {sync.status === "error" && "同步：失敗"}
        </button>
```

4. `ConfirmModal` 呼叫前（JSX 底部）加：

```tsx
      {syncModalOpen && (
        <SyncSettingsModal sync={sync} modalRef={modalRef} onClose={() => setSyncModalOpen(false)} />
      )}
```

5. 同步錯誤可見化：noticeStack 條件加入 `sync.status === "error"`，並在 capabilityMessage 區塊後加：

```tsx
          {sync.status === "error" && sync.errorMessage && (
            <p className="notice warning">
              {sync.errorMessage}
              <button type="button" className="secondaryButton" onClick={sync.syncNow}>
                重試
              </button>
            </p>
          )}
```

6. `confirmReset` 的確認文案調整：`ConfirmModal` 呈現的 reset 描述文字（在 `ConfirmModal.tsx`）由

「這會以內建示範資料取代目前本機看板。取消時不會變更任何資料。」改為接收動態警語 — 最小改法：`BoardApp` 傳入 prop。為避免改 ConfirmModal 介面，改為在 `confirmReset()` 完成後由既有 `liveMessage` 宣告即可，並於 `ConfirmModal.tsx` 的 reset 文案句尾加一句（靜態）：「若已啟用雲端同步，重設結果也會同步給所有成員。」

- [ ] **Step 3: `app/globals.css` 樣式（檔尾）**

```css
.syncPill {
  align-self: flex-start;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--paper);
  padding: 8px 14px;
  min-height: 44px;
  font-size: 0.9rem;
  color: var(--muted);
}

.syncPill.synced {
  color: var(--green);
  border-color: var(--green);
}

.syncPill.error {
  color: var(--rose);
  border-color: var(--rose);
}

.syncPill.pending,
.syncPill.syncing {
  color: var(--amber);
  border-color: var(--amber);
}

.syncStatusLine {
  margin: 0 0 12px;
}

.syncErrorText {
  color: var(--rose);
}

.syncActions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.syncForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.syncModeChoice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
```

- [ ] **Step 4: 全面驗證 + 本機端到端煙霧**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過

本機端到端（兩個終端 + chrome-devtools MCP）：
1. 終端 A：`pnpm sync:dev`（本機 miniflare D1 自動建立；先 `wrangler d1 migrations apply kanban-sync --local -c worker-sync/wrangler.jsonc`，再以 `wrangler d1 execute kanban-sync --local -c worker-sync/wrangler.jsonc --command "INSERT INTO users VALUES ('u1','測試', '<sha256 of testtoken>')"` 植入測試 token；sha256 可用 `node -e "crypto.subtle.digest('SHA-256', new TextEncoder().encode('testtoken')).then(d=>console.log([...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')))"`）。
2. 終端 B：`pnpm dev`，瀏覽器開啟 → 點同步 pill → 輸入 `http://localhost:8787` + `testtoken` → 「以遠端為準」→ 啟用（遠端空 → 推送本機為 revision 1）→ pill 顯示「已同步」。
3. 開第二個瀏覽器分頁（同 profile 會共享 localStorage — 用無痕/另一 profile 模擬第二裝置）→ 同樣設定 → 新增卡片 → 回第一分頁切前景 → 卡片出現（收斂）。
4. 刪卡在兩端收斂且不復活；斷開 `sync:dev` → 改卡 → pill 顯示「失敗」+ 通知區出現可重試錯誤 → 重啟 server → 重試成功。
5. Console 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add app/components/board/SyncSettingsModal.tsx app/components/board/BoardApp.tsx app/components/board/ConfirmModal.tsx app/globals.css
git commit -m "Add sync status pill and settings modal"
```

---

### Task 6: 部署與正式端到端驗證

**Files:**
- Modify: `worker-sync/wrangler.jsonc`（填入真實 database_id）
- Modify: `README.md`（同步章節）
- Create: `.env.sync-tokens`（token 交付，被 `.env*` gitignore 排除，不入版控）

**前置：使用者已執行 `npx wrangler login`。**

- [ ] **Step 1: 驗證登入**

Run: `npx wrangler whoami`
Expected: 顯示帳號 email。若未登入：停止，回報請使用者執行 `! npx wrangler login`。

- [ ] **Step 2: 建立 D1 並套用 migration**

```bash
npx wrangler d1 create kanban-sync
# 從輸出取得 database_id，寫入 worker-sync/wrangler.jsonc 取代占位字串
pnpm sync:migrate
```

Expected: migration 成功（2 張表）

- [ ] **Step 3: 部署 Worker**

Run: `pnpm sync:deploy`
Expected: 輸出 `https://kanban-sync.<subdomain>.workers.dev`

- [ ] **Step 4: 產生 token 並植入使用者**

```bash
node -e '
const crypto = require("node:crypto");
for (const name of ["member-1", "member-2"]) {
  const token = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  console.log(`${name}\t${token}\t${hash}`);
}'
```

以輸出的 hash 執行（每人一句）：

```bash
npx wrangler d1 execute kanban-sync --remote -c worker-sync/wrangler.jsonc \
  --command "INSERT INTO users (id, name, token_hash) VALUES ('member-1', '成員一', '<hash1>')"
```

把兩組 `名稱 + token`（明文）寫入 `.env.sync-tokens` 並確認 `git check-ignore .env.sync-tokens` 命中。

- [ ] **Step 5: curl 端到端驗證**

```bash
BASE=https://kanban-sync.<subdomain>.workers.dev
curl -s -o /dev/null -w "%{http_code}" $BASE/board                          # 401
curl -s -H "Authorization: Bearer <token1>" $BASE/board                     # 404 empty
curl -s -X PUT -H "Authorization: Bearer <token1>" -H "Content-Type: application/json" \
  -d '{"baseRevision":0,"board":{"columns":[],"cards":{}}}' $BASE/board     # {"revision":1}
curl -s -H "Authorization: Bearer <token1>" $BASE/board                     # revision 1 + board
curl -s -X PUT -H "Authorization: Bearer <token1>" -H "Content-Type: application/json" \
  -d '{"baseRevision":0,"board":{"columns":[],"cards":{}}}' $BASE/board     # 409
```

Expected: 註解所示狀態碼/內容逐一相符。驗證後清空測試資料：`npx wrangler d1 execute kanban-sync --remote -c worker-sync/wrangler.jsonc --command "DELETE FROM board"`。

- [ ] **Step 6: 真實環境 UI 煙霧**

`pnpm dev` + chrome-devtools：以正式 URL + token1 啟用（以遠端為準；遠端空 → 本機成為 revision 1）→ 已同步；無痕分頁以 token2 啟用（以遠端為準）→ 看到同一看板；互改一張卡 → 前景切換後收斂。

- [ ] **Step 7: README 同步章節**

在 Mobile 段落之後插入：

```markdown
## 雲端同步（階段 3a）

看板經 `worker-sync/`（Cloudflare Worker + D1）跨裝置同步：單一共用看板、Bearer token 認證、revision 樂觀鎖，衝突以卡片級 updatedAt LWW 合併（刪除有墓碑保護）。離線優先 — 本機永遠可用，恢復連線後自動補推。

- 啟用：看板右上「同步」pill → 輸入 Worker 網址與 token
- 部署：`pnpm sync:migrate && pnpm sync:deploy`（需 `wrangler login`；database_id 在 `worker-sync/wrangler.jsonc`）
- 發 token：產生隨機字串，SHA-256 後 INSERT 進 D1 `users` 表（明文交給成員）
- 附件檔案的雲端同步屬階段 3b，目前附件僅存於擷取它的裝置
```

- [ ] **Step 8: Commit**

```bash
git add worker-sync/wrangler.jsonc README.md
git commit -m "Deploy sync worker and document cloud sync"
```

---

## Self-Review 紀錄

- **Spec 覆蓋**：spec 6 部署（獨立 Worker + D1）→ Task 3/6；認證（users 表 token hash、手動發放、header）→ Task 3/6；同步模型（revision 樂觀鎖、卡片級 LWW、觸發時機：啟動/debounce/前景、常駐狀態 UI + 手動重試）→ Task 4/5；spec 7（失敗可見可重試、401 提示重設 token 且本地不受影響、絕不假報已同步 — `lastPushedRef` 僅在 200 後更新）→ Task 4/5；spec 8 單元測試（合併 + revision 衝突 + 遷移）→ Task 1/2/3。附件流與 R2 → 3b 計畫。
- **墓碑設計**為 spec 未載的必要補充（防 LWW 復活刪卡），已在計畫頭聲明。
- **型別一致性**：`SyncConfig`/`SyncHandle`/`PushResult` 在 Task 4 定義、Task 5 消費，簽名逐一核對；`mergeBoards` 簽名 Task 2 定義、Task 4 使用；worker 端點契約 Task 3 定義、Task 4 `api.ts` 對應（404→null、409→conflict body）。
- **無占位符**：wrangler.jsonc 的 `TO-BE-SET-BY-DEPLOY-TASK` 是 Task 6 Step 2 的明確填值指令，非 TBD。
