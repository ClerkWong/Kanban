# 多看板與看板指派專注視圖 v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢復一個 Project 內建立多個看板，並讓 owner 指派每位 member 可見的看板；被指派單一看板的 member 進專案直接看到任務，介面沒有看板切換器。

**Architecture:** D1 migration `0005` 移除 `0003` 建立的單看板唯一索引並新增 `project_member_boards` join table。Worker 新增單一責任模組 `board-access.ts` 負責「可見看板集合」判定，由 boards／attachments／logs／reports 四處引用，member 存取非可見看板一律 404。指派 API 為 owner-only 的完整集合覆寫。Client 端因 `listBoards` 已被 Worker 收斂，只需最小改動：單一可見看板時隱藏切換器並自動落板。

**Tech Stack:** Cloudflare Workers、D1（SQLite）、vitest-pool-workers integration tests、React 19／vinext、node:test（client 單元測試）。

## Global Constraints

- Worker 角色欄位歷史命名：`manager` = 產品的 owner、`contributor` = 產品的 member；`viewer` 為 legacy 唯讀。
- member 對非可見看板一律回 **404 `not_found`**，不可回 403（403 會洩漏看板存在）。
- 「沒有指派列」的 member 視同被指派至**主要看板**：active 看板中 `ORDER BY updated_at DESC, id DESC LIMIT 1`（與 `0003` 的 preferred 判定同規則）。
- owner 與 legacy viewer 恆可見專案內全部看板，不需指派列；resolution 對這兩種角色回 `null`（代表全可見）。
- 指派 API 以完整集合覆寫；空陣列代表清除指派並回到主要看板 fallback。
- Activity Log 新增 `member.boards_assigned`，metadata 只含 `userId` 與 `boardIds`，不得含看板名稱或卡片內容。
- 每位 member 最多 50 個指派看板（`MAX_ASSIGNED_BOARDS`）。
- 所有 UI 文案繁體中文。
- migration 為 additive 且向前相容：既有 client 不知道指派概念，行為由 fallback 承接。

---

### Task 1: Migration 0005 與可見看板判定模組

**Files:**
- Create: `worker-sync/migrations/0005_multi_board_assignments.sql`
- Create: `worker-sync/src/board-access.ts`
- Test: `worker-sync/test/board-access.integration.test.ts`

**Interfaces:**
- Produces（後續 Task 2–5 使用）：
  - `resolveVisibleBoardIds(database: D1Database, projectId: string, userId: string, access: ProjectAccess): Promise<Set<string> | null>` — 回 `null` 代表全部可見。
  - `requireBoardVisible(database: D1Database, projectId: string, boardId: string, userId: string, access: ProjectAccess): Promise<void>` — 不可見時 `throw new RequestError(404, "not_found")`。
  - `MAX_ASSIGNED_BOARDS = 50`

- [ ] **Step 1: 寫 migration**

`worker-sync/migrations/0005_multi_board_assignments.sql`：

```sql
PRAGMA foreign_keys = ON;

-- 0003 以唯一索引硬性限制每專案一個 active Board；產品已改為支援多看板。
DROP INDEX IF EXISTS boards_one_active_per_project_unique;

CREATE TABLE project_member_boards (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id, board_id),
  FOREIGN KEY (project_id, user_id)
    REFERENCES project_members(project_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX project_member_boards_user_idx
  ON project_member_boards(project_id, user_id);
```

- [ ] **Step 2: 寫失敗測試**

`worker-sync/test/board-access.integration.test.ts`。fixture／request helper 沿用
`worker-sync/test/boards.integration.test.ts` 既有寫法（先讀該檔開頭的 helper 與
beforeEach，包含 owner／contributor token 的建立方式），本檔沿用同一組 helper。

測試意圖（每項都要有具體斷言）：

1. `0005` 套用後可建立第二個 active Board（`POST /projects/:id/boards` 兩次都回 201/200，
   `GET /projects/:id/boards?status=active` 回兩筆）。
2. 無指派列的 contributor：`resolveVisibleBoardIds` 只回主要看板 id（建立兩個 board，
   第二個 `updated_at` 較新 → 主要看板為第二個）。
3. 有指派列的 contributor：插入指派列後，回傳集合等於指派集合，fallback 失效。
4. owner（`manager`）與 `viewer`：回 `null`。
5. 移除 membership 後指派列被 cascade 清除（`DELETE FROM project_members` 後查
   `project_member_boards` 為 0 筆）。

- [ ] **Step 3: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/board-access.integration.test.ts
```

預期：FAIL（模組不存在／第二個 board 撞唯一索引）。

- [ ] **Step 4: 實作 board-access.ts**

```ts
import type { ProjectAccess } from "./authorization";
import { RequestError } from "./validation";

export const MAX_ASSIGNED_BOARDS = 50;

/** 主要看板：active 看板中最後更新者，同時間取 id 較大者（與 migration 0003 的
 *  preferred 判定同規則）。專案沒有 active 看板時回 null。 */
async function primaryBoardId(
  database: D1Database,
  projectId: string,
): Promise<string | null> {
  return await database.prepare(
    `SELECT id FROM boards
     WHERE project_id = ? AND status = 'active'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(projectId).first<string>("id");
}

/** 回傳 caller 在此專案可見的 board id 集合；null 代表全部可見。
 *  owner（manager）與 legacy viewer 恆全可見；member（contributor）依指派列，
 *  完全沒有指派列時 fallback 到主要看板。 */
export async function resolveVisibleBoardIds(
  database: D1Database,
  projectId: string,
  userId: string,
  access: ProjectAccess,
): Promise<Set<string> | null> {
  if (access.projectRole !== "contributor") return null;
  const assigned = await database.prepare(
    "SELECT board_id FROM project_member_boards WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, userId).all<{ board_id: string }>();
  if (assigned.results.length) {
    return new Set(assigned.results.map((row) => row.board_id));
  }
  const primary = await primaryBoardId(database, projectId);
  return new Set(primary ? [primary] : []);
}

/** 不可見時以 404 拒絕——403 會洩漏看板存在。 */
export async function requireBoardVisible(
  database: D1Database,
  projectId: string,
  boardId: string,
  userId: string,
  access: ProjectAccess,
): Promise<void> {
  const visible = await resolveVisibleBoardIds(database, projectId, userId, access);
  if (visible && !visible.has(boardId)) {
    throw new RequestError(404, "not_found");
  }
}
```

- [ ] **Step 5: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/board-access.integration.test.ts
pnpm worker:test
pnpm worker:types:check
```

預期全綠。若既有測試因「每專案只能一個 active board」的假設而失敗，該假設已被本
規格取代——更新該測試的斷言並在報告中列出所有被改動的測試與理由。

- [ ] **Step 6: Commit**

```bash
git add worker-sync/migrations/0005_multi_board_assignments.sql worker-sync/src/board-access.ts worker-sync/test/board-access.integration.test.ts
git commit -m "feat: allow multiple boards per project and resolve visible boards"
```

### Task 2: Board 讀寫端點的可見性強制

**Files:**
- Modify: `worker-sync/src/boards.ts`（`listBoards`、`getBoardDetail`、`putBoardContent`、`handleLegacyAlias`）
- Test: `worker-sync/test/boards.integration.test.ts`（附加）

**Interfaces:**
- Consumes: Task 1 的 `resolveVisibleBoardIds`、`requireBoardVisible`。

- [ ] **Step 1: 寫失敗測試**

附加到 `worker-sync/test/boards.integration.test.ts`，沿用該檔既有 helper：

1. 專案有 board A（較舊）與 board B（較新，即主要看板）。無指派列的 contributor：
   - `GET /projects/:p/boards?status=active` 只回 B。
   - `GET /projects/:p/boards/:A` 回 **404**，`.../boards/:A/content` PUT 回 **404**。
   - `GET /projects/:p/boards/:B` 回 200。
2. 為該 contributor 插入「只指派 A」的指派列後：A 回 200、B 回 404、列表只回 A。
3. owner 對 A 與 B 都回 200，列表回兩筆。
4. archived 看板：contributor 被指派 A 後把 A 封存（owner 操作），
   `GET /projects/:p/boards?status=archived` 對該 contributor 回 A（維持可見、唯讀）。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/boards.integration.test.ts
```

預期：新測試 FAIL（目前 contributor 可讀全部看板）。

- [ ] **Step 3: 實作**

`listBoards`：在既有 `authorizeProject(...)` 之後、查詢結果回傳之前加入過濾。

```ts
async function listBoards(context: ApiContext, projectId: string): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  const rawStatus = new URL(context.request.url).searchParams.get("status") ?? "active";
  if (rawStatus !== "active" && rawStatus !== "archived") {
    throw new RequestError(400, "invalid_status");
  }
  const result = await context.env.DB.prepare(
    `SELECT id, project_id, name, normalized_name, status, revision,
            created_by, created_at, updated_at, archived_at, archived_by
     FROM boards
     WHERE project_id = ? AND status = ?
     ORDER BY updated_at DESC, id DESC`,
  ).bind(projectId, rawStatus).all<BoardListRow>();
  const visible = await resolveVisibleBoardIds(
    context.env.DB,
    projectId,
    context.user.id,
    access,
  );
  const rows = visible
    ? result.results.filter((row) => visible.has(row.id))
    : result.results;
  return json(200, {
    boards: rows.map(boardMetadata),
    requestId: context.requestId,
  }, context.requestId);
}
```

`getBoardDetail` 與 `putBoardContent`：在各自取得 `access` 之後、`getBoard(...)`
之前（或之後、任何 mutation 之前）插入一行：

```ts
  await requireBoardVisible(context.env.DB, projectId, boardId, context.user.id, access);
```

`handleLegacyAlias`：先讀該函式如何解析出 boardId；若它為 caller 解析出特定 board，
同樣在解析後插入上面那行；若它只服務 legacy 單看板 token（無 project 概念），
不需改動——在報告中說明實際情況與判斷依據。

import 區加入：

```ts
import { requireBoardVisible, resolveVisibleBoardIds } from "./board-access";
```

- [ ] **Step 4: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/boards.integration.test.ts
pnpm worker:test
```

- [ ] **Step 5: Commit**

```bash
git add worker-sync/src/boards.ts worker-sync/test/boards.integration.test.ts
git commit -m "feat: enforce board visibility on board endpoints"
```

### Task 3: 附件與 Activity Log 的可見性強制

**Files:**
- Modify: `worker-sync/src/attachments.ts`
- Modify: `worker-sync/src/logs.ts`
- Test: `worker-sync/test/attachments-scoped.integration.test.ts`（附加）
- Test: `worker-sync/test/logs.integration.test.ts`（附加）

**Interfaces:**
- Consumes: Task 1 的 `requireBoardVisible`。

- [ ] **Step 1: 寫失敗測試**

附件（附加到 `attachments-scoped.integration.test.ts`，沿用該檔 helper）：
專案有 board A、B（B 為主要看板）。無指派列的 contributor 對 board A 的
attachment PUT、GET、DELETE 三個動作都回 **404**；對 board B 的同樣三動作正常
（PUT 200/201、GET 200、DELETE 200/204，實際期望值以該檔既有測試的斷言為準）。
owner 對 A 也正常。

Log（附加到 `logs.integration.test.ts`）：contributor 讀 board A 的 board-scoped
Log 回 **404**；讀 board B 正常；owner 讀 A 正常。若該檔的 Log 端點是 project-scoped
且以 query 參數指定 board，則斷言「指定非可見 board 時回 404」。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/attachments-scoped.integration.test.ts worker-sync/test/logs.integration.test.ts
```

- [ ] **Step 3: 實作**

兩個檔案都在既有 `authorizeProject(...)` 取得 `access`、且在**任何 R2 或 D1 讀寫
之前**插入：

```ts
  await requireBoardVisible(context.env.DB, projectId, boardId, context.user.id, access);
```

import：`import { requireBoardVisible } from "./board-access";`

必須在碰 R2 之前檢查——既有測試已建立「authz 失敗不碰 R2」的保證，本次不得破壞。
若 `logs.ts` 的 board 參數為 optional，只在有指定 boardId 時檢查；未指定時
（project-scoped 查詢）改為以 `resolveVisibleBoardIds` 過濾結果中的 board-scoped
事件，並在報告中說明採用哪一種。

- [ ] **Step 4: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/attachments-scoped.integration.test.ts worker-sync/test/logs.integration.test.ts
pnpm worker:test
```

- [ ] **Step 5: Commit**

```bash
git add worker-sync/src/attachments.ts worker-sync/src/logs.ts worker-sync/test/attachments-scoped.integration.test.ts worker-sync/test/logs.integration.test.ts
git commit -m "feat: enforce board visibility on attachments and logs"
```

### Task 4: Project summary 依可見看板聚合

**Files:**
- Modify: `worker-sync/src/reports.ts`（`handleReportRequest`）
- Test: `worker-sync/test/reports.integration.test.ts`（附加）

**Interfaces:**
- Consumes: Task 1 的 `resolveVisibleBoardIds`。

- [ ] **Step 1: 寫失敗測試**

附加到 `worker-sync/test/reports.integration.test.ts`（沿用該檔 helper 與
`currentTaipeiMonthKey`）：專案有 board A、B，各有一張已完成卡片（`completedAt`
用動態日期，避免時間耦合——照該檔既有做法）。無指派列的 contributor 呼叫
`GET /projects/:p/summary`：

- `summary.boardCount` 為 1、`summary.boards` 只含主要看板 B。
- `summary.stats.completed` 與當月 `monthlyCompletions` 的 `count` 只計 B 的卡片。

owner 呼叫同一端點：`boardCount` 為 2、統計含兩張卡片。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/reports.integration.test.ts
```

- [ ] **Step 3: 實作**

`handleReportRequest` 目前是：`authorizeProject(...)` → 查 boards → `buildProjectSummary`。
改為保留 `access`，並在 `buildProjectSummary` 之前過濾 rows：

```ts
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  // ...既有 includeArchived 解析與 SELECT 不變...
  const visible = await resolveVisibleBoardIds(
    context.env.DB,
    projectId,
    context.user.id,
    access,
  );
  const rows = visible
    ? result.results.filter((row) => visible.has(row.id))
    : result.results;
  return json(200, {
    projectId,
    summary: buildProjectSummary(rows, includeArchived),
    requestId: context.requestId,
  }, context.requestId);
```

`buildProjectSummary` 本身不改（純函式，rows 進 rows 出）。
import：`import { resolveVisibleBoardIds } from "./board-access";`

- [ ] **Step 4: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/reports.integration.test.ts
pnpm worker:test
```

- [ ] **Step 5: Commit**

```bash
git add worker-sync/src/reports.ts worker-sync/test/reports.integration.test.ts
git commit -m "feat: scope project summary to visible boards"
```

### Task 5: 看板指派 API（owner-only）

**Files:**
- Create: `worker-sync/src/member-boards.ts`
- Modify: `worker-sync/src/router.ts`（註冊 handler）
- Test: `worker-sync/test/member-boards.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MAX_ASSIGNED_BOARDS`。
- Produces（Task 6 的 client 對接）：
  - `GET /projects/:projectId/members/:userId/boards` → `{ boardIds: string[], requestId }`
  - `PUT /projects/:projectId/members/:userId/boards`，body `{ boardIds: string[] }` → 同上格式。

- [ ] **Step 1: 寫失敗測試**

`worker-sync/test/member-boards.integration.test.ts`，helper 沿用
`worker-sync/test/memberships.integration.test.ts`（若不存在則沿用
`projects.integration.test.ts`）的既有寫法：

1. owner PUT `{ boardIds: [A] }` → 200 且回 `{ boardIds: [A] }`；GET 回 `[A]`。
2. 指派生效：該 contributor 對 A 回 200、對 B 回 404（跨 Task 2 行為，用 HTTP 驗證）。
3. owner PUT `{ boardIds: [] }` → 200，`boardIds` 為 `[]`；該 contributor 回到
   fallback（主要看板 B 回 200）。
4. 冪等：同一 PUT 連續兩次都 200 且結果相同。
5. contributor 呼叫 PUT → **403**。
6. 不存在或屬於別專案的 boardId → **400 `invalid_board_ids`**。
7. 超過 50 個 boardId → **400 `invalid_board_ids`**。
8. 目標 user 非本專案成員 → **404 `user_not_found`**。
9. Activity Log 出現 `member.boards_assigned`，且 metadata 不含看板名稱。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/member-boards.integration.test.ts
```

- [ ] **Step 3: 實作 member-boards.ts**

```ts
import { prepareAuditEvent } from "./audit";
import { authorizeProject } from "./authorization";
import { MAX_ASSIGNED_BOARDS } from "./board-access";
import type { ProjectRow } from "./db-types";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid, readJsonObject } from "./validation";

async function projectRow(database: D1Database, projectId: string): Promise<ProjectRow> {
  const row = await database.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId).first<ProjectRow>();
  if (!row) throw new RequestError(404, "not_found");
  return row;
}

async function requireProjectMember(
  database: D1Database,
  projectId: string,
  userId: string,
): Promise<void> {
  const row = await database.prepare(
    "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, userId).first<string>("user_id");
  if (!row) throw new RequestError(404, "user_not_found");
}

async function listAssignments(
  database: D1Database,
  projectId: string,
  userId: string,
): Promise<string[]> {
  const result = await database.prepare(
    `SELECT board_id FROM project_member_boards
     WHERE project_id = ? AND user_id = ?
     ORDER BY board_id`,
  ).bind(projectId, userId).all<{ board_id: string }>();
  return result.results.map((row) => row.board_id);
}

function parseBoardIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ASSIGNED_BOARDS) {
    throw new RequestError(400, "invalid_board_ids");
  }
  const ids = new Set<string>();
  for (const candidate of value) {
    let boardId: string;
    try {
      boardId = parseUuid(candidate, "board_id");
    } catch {
      throw new RequestError(400, "invalid_board_ids");
    }
    ids.add(boardId);
  }
  return [...ids];
}

async function requireBoardsInProject(
  database: D1Database,
  projectId: string,
  boardIds: string[],
): Promise<void> {
  if (!boardIds.length) return;
  const placeholders = boardIds.map(() => "?").join(", ");
  const found = await database.prepare(
    `SELECT id FROM boards WHERE project_id = ? AND id IN (${placeholders})`,
  ).bind(projectId, ...boardIds).all<{ id: string }>();
  if (found.results.length !== boardIds.length) {
    throw new RequestError(400, "invalid_board_ids");
  }
}

async function putAssignments(
  context: ApiContext,
  projectId: string,
  targetUserId: string,
): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  await requireProjectMember(context.env.DB, projectId, targetUserId);
  const body = await readJsonObject(context.request, ["boardIds"]);
  const boardIds = parseBoardIds(body.boardIds);
  await requireBoardsInProject(context.env.DB, projectId, boardIds);
  const project = await projectRow(context.env.DB, projectId);
  const now = new Date().toISOString();

  const statements = [
    context.env.DB.prepare(
      "DELETE FROM project_member_boards WHERE project_id = ? AND user_id = ?",
    ).bind(projectId, targetUserId),
    ...boardIds.map((boardId) => context.env.DB.prepare(
      `INSERT INTO project_member_boards (
         project_id, user_id, board_id, assigned_by, assigned_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectId, targetUserId, boardId, context.user.id, now)),
    prepareAuditEvent(context.env.DB, {
      id: crypto.randomUUID(),
      workspaceId: project.workspace_id,
      projectId,
      boardId: null,
      actorUserId: context.user.id,
      action: "member.boards_assigned",
      entityType: "membership" as const,
      entityId: targetUserId,
      revision: null,
      // 只記 ID，不記看板名稱或卡片內容。
      metadata: { userId: targetUserId, boardIds },
      occurredAt: now,
    }, true),
  ];
  await context.env.DB.batch(statements);
  return json(200, { boardIds, requestId: context.requestId }, context.requestId);
}

export async function handleMemberBoardsRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  const match = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/members\/([0-9a-f-]+)\/boards$/i,
  );
  if (!match) return null;
  await requireMigrationComplete(context.env.DB);
  const projectId = parseUuid(match[1], "project_id");
  const targetUserId = parseUuid(match[2], "user_id");

  if (context.request.method === "GET") {
    await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
    await requireProjectMember(context.env.DB, projectId, targetUserId);
    return json(200, {
      boardIds: await listAssignments(context.env.DB, projectId, targetUserId),
      requestId: context.requestId,
    }, context.requestId);
  }
  if (context.request.method === "PUT") {
    return putAssignments(context, projectId, targetUserId);
  }
  return null;
}
```

- [ ] **Step 4: 註冊到 router**

先讀 `worker-sync/src/router.ts` 現有 handler 串接順序與寫法，把
`handleMemberBoardsRequest` 加入。**必須排在 `handleMembershipRequest` 之前**——
membership 的 regex 為 `/projects/:id/members/:userId`，若先執行可能吃掉
`/boards` 後綴路徑；註冊後以 Step 1 的測試驗證路由確實命中新 handler。

- [ ] **Step 5: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/member-boards.integration.test.ts
pnpm worker:test
pnpm worker:types:check
```

- [ ] **Step 6: Commit**

```bash
git add worker-sync/src/member-boards.ts worker-sync/src/router.ts worker-sync/test/member-boards.integration.test.ts
git commit -m "feat: add owner-only board assignment API"
```

### Task 6: Client 指派 API 與型別

**Files:**
- Modify: `app/projects/api.ts`
- Test: `tests/project-api.test.ts`（附加）

**Interfaces:**
- Consumes: Task 5 的兩個端點。
- Produces（Task 8 使用）：
  - `listMemberBoards(config: SyncConfig, projectId: string, userId: string): Promise<string[]>`
  - `putMemberBoards(config: SyncConfig, projectId: string, userId: string, boardIds: string[]): Promise<string[]>`

- [ ] **Step 1: 寫失敗測試**

附加到 `tests/project-api.test.ts`，沿用該檔既有的 fetch stub 寫法：

1. `listMemberBoards` 對 `{"boardIds":["<uuid>"],"requestId":"r"}` 回 `["<uuid>"]`，
   且請求 URL 為 `/projects/<p>/members/<u>/boards`、method 為 GET。
2. `putMemberBoards` 送出的 body 為 `{"boardIds":[...]}`、method 為 PUT，
   回傳解析後的陣列。
3. response 缺 `boardIds` 或 `boardIds` 非字串陣列時 throw（沿用該檔既有的
   嚴格 parser 斷言風格）。

- [ ] **Step 2: 執行確認失敗**

```bash
pnpm exec tsx --test tests/project-api.test.ts
```

- [ ] **Step 3: 實作**

在 `app/projects/api.ts` 加入（`assertResourceId`、`apiPath`、`requestJson` 都是
該檔既有 helper，沿用；嚴格解析風格照該檔既有 parser）：

```ts
function parseBoardIdsResponse(value: unknown, operation: string): string[] {
  const raw = (value as { boardIds?: unknown } | null)?.boardIds;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`${operation} 回應格式不正確。`);
  }
  return raw as string[];
}

export async function listMemberBoards(
  config: SyncConfig,
  projectId: string,
  userId: string,
): Promise<string[]> {
  assertResourceId(projectId, "project_id");
  assertResourceId(userId, "user_id");
  return parseBoardIdsResponse(
    await requestJson(
      config,
      apiPath("projects", projectId, "members", userId, "boards"),
      "讀取成員看板指派",
    ),
    "讀取成員看板指派",
  );
}

export async function putMemberBoards(
  config: SyncConfig,
  projectId: string,
  userId: string,
  boardIds: string[],
): Promise<string[]> {
  assertResourceId(projectId, "project_id");
  assertResourceId(userId, "user_id");
  for (const boardId of boardIds) assertResourceId(boardId, "board_id");
  return parseBoardIdsResponse(
    await requestJson(
      config,
      apiPath("projects", projectId, "members", userId, "boards"),
      "更新成員看板指派",
      { method: "PUT", body: JSON.stringify({ boardIds }) },
    ),
    "更新成員看板指派",
  );
}
```

- [ ] **Step 4: 執行至通過**

```bash
pnpm exec tsx --test tests/project-api.test.ts
pnpm test
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add app/projects/api.ts tests/project-api.test.ts
git commit -m "feat: add member board assignment client API"
```

### Task 7: member 專注視圖（單板不顯示切換器）

**Files:**
- Modify: `app/components/projects/BoardNavigation.tsx`
- Modify: `app/components/projects/ProjectApp.tsx`

**Interfaces:**
- Consumes: Task 2 使 `listBoards` 只回可見看板，故 `state.activeBoards`／
  `state.allBoards` 對 member 已自動收斂。

- [ ] **Step 1: BoardNavigation 單板隱藏切換器**

把整個 `<div className="boardSwitcher">` 區塊改為條件渲染：看板數 ≤ 1 時只保留
角色徽章，不渲染 label 與 select。

```tsx
      {boards.length > 1 ? (
        <div className="boardSwitcher">
          <label htmlFor="boardSwitcher">切換看板</label>
          <select
            id="boardSwitcher"
            value={board.id}
            onChange={(event) => {
              window.location.hash = serializeProjectRoute({
                kind: "board",
                projectId: project.id,
                boardId: event.target.value,
              });
            }}
          >
            {boards.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}{entry.status === "archived" ? "（已封存）" : ""}
              </option>
            ))}
          </select>
          <span className="roleBadge">{projectRoleLabel(role)}</span>
        </div>
      ) : (
        <div className="boardSwitcher">
          <span className="roleBadge">{projectRoleLabel(role)}</span>
        </div>
      )}
```

- [ ] **Step 2: ProjectApp 單板 member 自動落板**

在 `void Promise.all([...]).then(([detail, report, members, activeBoards, archivedBoards]) => {...})`
內、既有 `if (route.kind === "board" && !boardBelongsToRoute(...))` 判斷**之後**，
加入自動導向：

```ts
        if (
          route.kind === "project" &&
          detail.myRole === "member" &&
          activeBoards.length === 1
        ) {
          window.location.hash = serializeProjectRoute({
            kind: "board",
            projectId: route.projectId,
            boardId: activeBoards[0].id,
          });
          return;
        }
```

owner 與 viewer 不受影響（維持專案總覽）。`detail.myRole` 是既有欄位，值為
`"owner" | "member" | "viewer"`（見 `app/projects/types.ts` 的 `ProjectRole`）。

- [ ] **Step 3: 指派被移除時的訊息**

既有的 `if (route.kind === "board" && !boardBelongsToRoute(route, allBoards))` 只做
靜默導回。指派被 owner 移除後，member 停留的 board 會落入這個分支，需要說明原因
而不是無聲跳頁。改為在導回前記下原因，導回後由 `state.error` 呈現：

```ts
        if (route.kind === "board" && !boardBelongsToRoute(route, allBoards)) {
          window.sessionStorage.setItem(
            "kanban-board-access-notice",
            "您已不在此看板，已回到可用的看板清單。",
          );
          window.location.hash = serializeProjectRoute({
            kind: "project",
            projectId: route.projectId,
          });
          return;
        }
```

並在 `setState({ detail, report, members, ... })` 的 `error` 欄位帶入這則訊息
（讀取後立即 `removeItem`，避免下次進入重複顯示）：

```ts
        const notice = window.sessionStorage.getItem("kanban-board-access-notice");
        if (notice) window.sessionStorage.removeItem("kanban-board-access-notice");
```

把 `error: notice ?? ""` 放進該次 `setState`。用 sessionStorage 而非 state 是因為
hash 導向會重跑這個 effect，state 會被重置。

- [ ] **Step 4: 驗證**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

預期全綠（本 task 無新單元測試檔——UI 元件在本專案無測試 harness，行為由
Task 10 的人工驗收清單覆蓋）。

- [ ] **Step 5: Commit**

```bash
git add app/components/projects/BoardNavigation.tsx app/components/projects/ProjectApp.tsx
git commit -m "feat: focus member view on the single assigned board"
```

### Task 8: owner 指派 UI

**Files:**
- Modify: `app/components/projects/ProjectMembersPanel.tsx`

**Interfaces:**
- Consumes: Task 6 的 `listMemberBoards`、`putMemberBoards`；`BoardMeta` 型別
  來自 `app/projects/types.ts`。

- [ ] **Step 1: 面板接收看板清單**

`ProjectMembersPanel` 的 props 新增 `boards: BoardMeta[]`（active 看板），由
`ProjectApp` 傳入既有的 `state.activeBoards`。先讀該面板現有 props 與呼叫處，
沿用其風格加入。

- [ ] **Step 2: 每位 member 一組看板多選**

在既有 `memberRow` 內、`RoleSelect` 之後加入。只對 `member.role === "member"`
顯示（owner 恆全可見、viewer 維持現狀，顯示會誤導）：

```tsx
{member.role === "member" && (
  <label className="formField">
    <span>可見看板</span>
    <select
      multiple
      value={assignments[member.userId] ?? []}
      onChange={(event) => {
        const boardIds = [...event.target.selectedOptions].map((option) => option.value);
        void saveAssignments(member.userId, boardIds);
      }}
    >
      {boards.map((entry) => (
        <option key={entry.id} value={entry.id}>{entry.name}</option>
      ))}
    </select>
  </label>
)}
```

- [ ] **Step 3: 載入與儲存邏輯**

在元件內加入 state 與 handler：

```tsx
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    const targets = members.filter((entry) => entry.role === "member");
    void Promise.all(
      targets.map((entry) =>
        listMemberBoards(config, projectId, entry.userId)
          .then((boardIds) => [entry.userId, boardIds] as const)
          .catch(() => [entry.userId, []] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setAssignments(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [config, projectId, members]);

  async function saveAssignments(userId: string, boardIds: string[]) {
    try {
      const saved = await putMemberBoards(config, projectId, userId, boardIds);
      setAssignments((current) => ({ ...current, [userId]: saved }));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新看板指派失敗，請稍後再試。");
    }
  }
```

`config`、`projectId`、`members`、`setError` 都是該面板既有的 props／state——
先讀檔案確認實際命名再對接，不要新增重複的 state。空選（清除指派）維持送出
空陣列，語意是「回到主要看板」，在 `<span>` 旁加註說明文字：
`<small>未選擇時預設只看主要看板。</small>`

- [ ] **Step 4: 驗證**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add app/components/projects/ProjectMembersPanel.tsx app/components/projects/ProjectApp.tsx
git commit -m "feat: assign visible boards to members from the owner panel"
```

### Task 9: owner 新增看板入口

**Files:**
- Modify: `app/components/projects/ProjectOverview.tsx`
- Modify: `app/components/projects/ProjectApp.tsx`

**Interfaces:**
- Consumes: 既有但目前無人引用的 `app/components/projects/CreateBoardModal.tsx`
  與 `createBoard(config, { context, boardId, name, board })`（`app/projects/api.ts`）。

- [ ] **Step 1: 讀 CreateBoardModal 的 props 契約**

先讀 `app/components/projects/CreateBoardModal.tsx`，記下它需要的 props 與
onSubmit 簽名；不要改它的介面（它是既有元件，只是沒被引用）。

- [ ] **Step 2: 在專案總覽加入 owner-only 按鈕**

`ProjectOverview` 加入「新增看板」按鈕，只在 owner 時渲染（該元件已有角色資訊
或由 `ProjectApp` 傳入 `canManage`——依實際 props 決定，沿用既有 gating 寫法）。
按鈕開啟 `CreateBoardModal`。

- [ ] **Step 3: 建立看板的提交邏輯**

在 `ProjectApp`（持有 `config` 與 route 的層）實作提交：新 board 的初始內容用
`createEmptyBoard()`（`app/board-model.ts` 既有 export），boardId 用
`crypto.randomUUID()`：

```ts
  async function handleCreateBoard(name: string) {
    const detail = state.detail;
    if (!detail) return;
    const created = await createBoard(config, {
      context: {
        workspaceId: detail.project.workspaceId,
        projectId: route.projectId,
      },
      boardId: crypto.randomUUID(),
      name,
      board: createEmptyBoard(),
    });
    window.location.hash = serializeProjectRoute({
      kind: "board",
      projectId: route.projectId,
      boardId: created.board.id,
    });
  }
```

`detail.project.workspaceId` 與 `created.board.id` 的實際欄位名以
`app/projects/types.ts` 的 `Project`／`BoardDetail` 定義為準——先讀再寫。
失敗時沿用該檔既有的錯誤呈現（`state.error` 或 notice）。

- [ ] **Step 4: 驗證**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add app/components/projects/ProjectOverview.tsx app/components/projects/ProjectApp.tsx
git commit -m "feat: let owners create additional boards"
```

### Task 10: 文件、完整品質關卡與行動版

**Files:**
- Modify: `README.md`
- Modify: `NextTasks.md`

- [ ] **Step 1: README 更新**

- 「Project／Board 與同步行為」清單：把「每個 Project 只有一個主要 Board」的描述
  改為「一個 Project 可有多個 Board；owner 指派每位 member 可見的 Board，member
  對未指派 Board 一律得到 404」。加一行：「未設定指派的 member 預設只看主要
  Board（最後更新的 active Board）」。

- [ ] **Step 2: NextTasks 更新**

- 「目前真實狀態」表新增一列：多看板與看板指派 v1，狀態為「已實作，待 staging
  部署與驗收」，說明含 migration `0005`、404 可見性、owner 指派 API。
- P0-4 驗收清單新增人工驗收項（沿用既有 `- [ ]` 格式）：
  - [ ] owner 可在同一專案建立第二個看板並正常切換、封存。
  - [ ] 單一指派的 member 進專案直接看到任務，畫面沒有看板切換器。
  - [ ] 多指派的 member 只看到被指派的看板。
  - [ ] member 直接輸入非指派看板的 hash route 會被導回，API 回 404。
  - [ ] 未設定指派的既有 member 升級後仍能正常使用主要看板。
  - [ ] member 的報表只聚合可見看板；owner 聚合全部。
  - [ ] 移除指派後該 member 的 client 停止重試並顯示可理解訊息。
- 把既有「行動版 build 6 仍載有舊版 mergeBoards」那一行更新為：mobile build 7
  需同時帶入 `100260a` 的合併修正與本次多看板指派。

- [ ] **Step 3: 完整品質關卡**

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

全部必須通過。任一失敗先判斷是本功能引入或既有問題：本功能引入的要修，既有問題
記錄於報告。

- [ ] **Step 4: Commit**

```bash
git add README.md NextTasks.md
git commit -m "docs: record multi-board assignment and focus view"
```

## 部署備註（執行者不自行執行）

本功能需 remote migration，屬外部變更，由使用者決定時機：

1. `pnpm sync:migrate:staging`（套用 `0005`）。
2. `pnpm sync:deploy:staging`。
3. `pnpm web:deploy:beta`。
4. mobile build 7（`LANG=en_US.UTF-8 pnpm mobile:sync`；Android gradle 需
   `JAVA_HOME=/opt/homebrew/opt/openjdk@21`）。

production 不在本次範圍（見 NextTasks P0-5）。
