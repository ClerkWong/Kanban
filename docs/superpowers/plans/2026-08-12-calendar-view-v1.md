# 跨專案日曆檢視 v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓管理者在一個月曆檢視裡看到跨專案的本月任務分布、誰的負擔集中在哪幾天，以及還有哪些未排程或未指派的任務可以推進。

**Architecture:** Worker 新增 `GET /calendar`，以 SQLite `json_each` 在 SQL 層展開 board JSON 的卡片並過濾月份與完成狀態（已實測 D1 支援）。可見範圍由新的 `resolveCalendarScope` 決定：workspace owner／admin 得到該 workspace 全部 active 專案，Project owner 只得到他 own 的。Client 端把月曆格子與負擔彙總抽成純函式模組以便單元測試，UI 只負責渲染。v1 純檢視、桌面專用。

**Tech Stack:** Cloudflare Workers、D1（SQLite JSON1）、vitest-pool-workers integration tests、React 19／vinext、node:test（client 單元測試）。

## Global Constraints

- 端點 `GET /calendar?workspaceId=<uuid>&month=YYYY-MM`，兩個 query 參數都必填。
- 可見範圍：workspace owner／admin → 該 workspace 全部 **active** 專案；Project owner（D1 `manager`）→ 他 own 的 active 專案；其餘身分 **403**；非該 workspace 成員 **404 `not_found`**（不洩漏）。
- 只回**未完成卡**（`completedAt` 為 null）、**active 專案的 active 看板**。
- 回應**不含**卡片描述、checklist、附件與阻塞原因——降低邊界放寬的暴露面。
- 未排程池上限 **200** 筆，超出時 `unscheduledTruncated: true`；看板上限 **50** 個，超出時 `boardsTruncated: true`。兩者都不得靜默截斷，UI 必須明示。
- 月份格式 `YYYY-MM`，不合法回 **400 `invalid_month`**；`workspaceId` 非 uuid 回 400。
- **不套用 `resolveVisibleBoardIds`**：日曆是管理者專屬，member 拿不到此端點。必須有測試證明 member 無法藉此繞過看板指派可見性。
- 逾期、阻塞、加急三種狀態在 UI 必須**同時有文字與樣式**區隔，不可只靠顏色。
- v1 桌面專用：視窗寬度 < **900 px** 時不渲染月曆，顯示「日曆檢視需要較寬的畫面，請在桌面瀏覽器使用。」以 CSS media query 判斷，不做平台偵測。
- 所有 UI 文案繁體中文。
- 測試不得硬編當月字串。

### 計畫層決議（規格未明確處）

1. **`workspaceId` 為必填**。規格 §6 明列「跨 workspace 聚合」不在範圍，而規格的端點簽章沒有 workspaceId。決議：比照既有 `/admin/users?workspaceId=` 慣例要求明確指定，維持單 workspace 語意。
2. **月份過濾用字串前綴，不做時區換算**。`dueDate` 是 date-only 的 `YYYY-MM-DD`，本身就是本地日曆日，因此 `dueDate LIKE 'YYYY-MM-%'` 即為正確的月份過濾。規格提到的 Asia/Taipei 只影響 client 端判定「今天」與逾期，由 client 用本地日期處理。
3. **卡片 id 取自 `json_each` 的 `key`**。`$.cards` 是物件（`Record<string, Card>`），`json_each` 對物件迭代時 `key` 即 card id，比讀 `$.id` 更可靠。
4. **月曆週起始為週日**，符合多數 zh-TW 日曆慣例。

---

### Task 1: Worker — 日曆可見範圍解析

**Files:**
- Create: `worker-sync/src/calendar.ts`
- Test: `worker-sync/test/calendar.integration.test.ts`

**Interfaces:**
- Produces（Task 2 使用）：
  - `type CalendarScope = { kind: "workspace" | "owned_projects"; projectIds: string[] }`
  - `resolveCalendarScope(database: D1Database, userId: string, workspaceId: string): Promise<CalendarScope>`
  - `MAX_CALENDAR_BOARDS = 50`、`MAX_UNSCHEDULED = 200`

- [ ] **Step 1: 寫失敗測試**

`worker-sync/test/calendar.integration.test.ts`。fixture 與 request helper 沿用
`worker-sync/test/projects.integration.test.ts` 的既有寫法（**各測試檔手寫 schema 是本專案
既有慣例**，本檔需自備 `workspaces`／`workspace_members`／`user_accounts`／`projects`／
`project_members`／`boards` 的 DDL，欄位與 `worker-sync/migrations/0002_multi_project.sql`
一致）。測試意圖：

1. workspace `admin` → `kind` 為 `"workspace"`，`projectIds` 含該 workspace **全部 active**
   專案（含他不是成員的那些），且**不含 archived** 專案。
2. workspace `owner` → 同上（與 admin 同路徑）。
3. 一般 workspace member 但是專案 `manager` → `kind` 為 `"owned_projects"`，只含他 own 的
   active 專案，不含別人的專案。
4. 一般 workspace member 且只是 `contributor` → throw `AuthorizationError`，status **403**。
5. 非該 workspace 成員 → throw `AuthorizationError`，status **404**。
6. 跨 workspace 隔離：使用者在 workspace B 也 own 一個專案時，查 workspace A 不會回到 B 的專案。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/calendar.integration.test.ts
```

預期：FAIL（模組不存在）。

- [ ] **Step 3: 實作**

```ts
import { AuthorizationError } from "./authorization";
import type { WorkspaceRole } from "./db-types";

/** 單次請求最多展開的看板數；超出時回應標記 boardsTruncated。 */
export const MAX_CALENDAR_BOARDS = 50;
/** 未排程池上限；超出時回應標記 unscheduledTruncated。 */
export const MAX_UNSCHEDULED = 200;

export type CalendarScope = {
  kind: "workspace" | "owned_projects";
  projectIds: string[];
};

/** 日曆可見範圍：workspace owner／admin 得到整個 workspace 的 active 專案；
 *  Project owner 只得到他 own 的；其餘 403；非 workspace 成員 404（不洩漏）。 */
export async function resolveCalendarScope(
  database: D1Database,
  userId: string,
  workspaceId: string,
): Promise<CalendarScope> {
  const workspaceRole = await database.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, userId).first<WorkspaceRole>("role");
  if (!workspaceRole) throw new AuthorizationError(404, "not_found");

  if (workspaceRole === "owner" || workspaceRole === "admin") {
    const all = await database.prepare(
      `SELECT id FROM projects
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY name COLLATE NOCASE, id`,
    ).bind(workspaceId).all<{ id: string }>();
    return { kind: "workspace", projectIds: all.results.map((row) => row.id) };
  }

  const owned = await database.prepare(
    `SELECT projects.id AS id
     FROM projects
     INNER JOIN project_members
       ON project_members.project_id = projects.id
      AND project_members.user_id = ?
      AND project_members.role = 'manager'
     WHERE projects.workspace_id = ? AND projects.status = 'active'
     ORDER BY projects.name COLLATE NOCASE, projects.id`,
  ).bind(userId, workspaceId).all<{ id: string }>();
  if (!owned.results.length) throw new AuthorizationError(403, "forbidden");
  return { kind: "owned_projects", projectIds: owned.results.map((row) => row.id) };
}
```

- [ ] **Step 4: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/calendar.integration.test.ts
pnpm worker:test
pnpm worker:types:check
```

- [ ] **Step 5: Commit**

```bash
git add worker-sync/src/calendar.ts worker-sync/test/calendar.integration.test.ts
git commit -m "feat: resolve calendar visibility scope"
```

### Task 2: Worker — 卡片查詢與 `/calendar` 端點

**Files:**
- Modify: `worker-sync/src/calendar.ts`
- Modify: `worker-sync/src/router.ts`
- Test: `worker-sync/test/calendar.integration.test.ts`（附加）

**Interfaces:**
- Consumes: Task 1 的 `resolveCalendarScope`、`MAX_CALENDAR_BOARDS`、`MAX_UNSCHEDULED`。
- Produces（Task 3 對接）：`GET /calendar?workspaceId=<uuid>&month=YYYY-MM` →

```jsonc
{
  "month": "2026-08",
  "scope": "workspace",
  "scheduled": [{
    "cardId": "...", "title": "...", "dueDate": "2026-08-14",
    "assigneeUserIds": ["..."], "projectId": "...", "projectName": "...",
    "boardId": "...", "boardName": "...", "blocked": true, "serviceClass": "expedite"
  }],
  "unscheduled": [ /* 同形狀，dueDate 為 "" */ ],
  "unscheduledTruncated": false,
  "boardsTruncated": false,
  "assignees": [{ "userId": "...", "displayName": "..." }],
  "requestId": "..."
}
```

- [ ] **Step 1: 寫失敗測試**

附加到同一測試檔。seed 兩個 active 專案、各一個 active 看板，board JSON 用
**schema v7 形狀**（至少含 `version`、`columns`、`cards`、`labels`、`settings`；卡片需含
`id`／`title`／`dueDate`／`completedAt`／`blocked`／`serviceClass`／`assigneeUserIds`）。
月份用**動態計算**（例如以固定注入的 `2026-08` 字串搭配該月日期），不得依賴「當月」。

測試意圖：

1. workspace admin 呼叫 → 200，`scope` 為 `"workspace"`，`scheduled` 含兩個專案在該月的卡片，
   每筆帶正確的 `projectName`／`boardName`。
2. **已完成卡不出現**（`completedAt` 非 null 的卡片不在任何清單裡）。
3. **archived 專案與 archived 看板的卡片不出現**。
4. `dueDate` 為空的卡進 `unscheduled`；有該月 `dueDate` 的進 `scheduled`；
   **月初當天與月末當天**（例如 `2026-08-01`、`2026-08-31`）的卡**都含括在內**；
   **鄰月**（上月最後一天 `2026-07-31`、下月第一天 `2026-09-01`）的卡都**不出現**在 `scheduled`。
5. `blocked` 為 boolean（不是 0／1）、`serviceClass` 為字串；缺 `serviceClass` 的舊卡回 `"standard"`。
6. `assignees` 只含實際出現在回傳卡片中的 userId，且有 `displayName`。
7. **回應不含** `description`／`checklist`／`attachments`／`blockedReason`
   （以 `JSON.stringify(body)` 不含刻意植入的描述字串斷言）。
8. Project owner（非 workspace admin）呼叫 → 200 且 `scope` 為 `"owned_projects"`，只含他的專案。
9. contributor 呼叫 → **403**；非 workspace 成員 → **404**；無 token → **401**。
10. **member 不能繞過看板指派可見性**：contributor 即使被指派某看板，呼叫 `/calendar` 仍 403
    （這是本端點最重要的安全斷言）。
11. `month` 為 `2026-13`／`2026-8`／缺少 → **400 `invalid_month`**；`workspaceId` 非 uuid → 400。
12. **`boardsTruncated`**：以迴圈 seed 51 個 active 看板（各一張該月卡片），斷言回應的
    `boardsTruncated` 為 true，且 `scheduled` 只來自 50 個看板（distinct `boardId` 數為 50）；
    seed 50 個時 `boardsTruncated` 為 false。
13. **SQL 與 Worker 內解析交叉比對**：把 seed 用的 board JSON 在測試中以 JS 自行過濾
    （`completedAt === null` 且 `dueDate.startsWith(month)`），斷言 cardId 集合與端點回傳的
    `scheduled` 完全相同——防止 SQL 條件寫錯而靜默漏卡。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/calendar.integration.test.ts
```

- [ ] **Step 3: 實作查詢與 handler**

在 `worker-sync/src/calendar.ts` 追加（import 區補 `json` 來自 `./http`、
`requireMigrationComplete` 與 `ApiContext` 來自 `./projects`、`RequestError`／`parseUuid`
來自 `./validation`）：

```ts
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type CardRow = {
  project_id: string;
  project_name: string;
  board_id: string;
  board_name: string;
  card_id: string;
  title: string;
  due_date: string | null;
  blocked: number | null;
  service_class: string | null;
  assignee_ids: string | null;
};

type CalendarCard = {
  cardId: string;
  title: string;
  dueDate: string;
  assigneeUserIds: string[];
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
  blocked: boolean;
  serviceClass: string;
};

const SERVICE_CLASSES = ["standard", "expedite", "fixedDate", "intangible"];

function toCalendarCard(row: CardRow): CalendarCard {
  let assigneeUserIds: string[] = [];
  if (row.assignee_ids) {
    try {
      const parsed = JSON.parse(row.assignee_ids) as unknown;
      if (Array.isArray(parsed)) {
        assigneeUserIds = parsed.filter((id): id is string => typeof id === "string");
      }
    } catch {
      assigneeUserIds = [];
    }
  }
  const serviceClass = row.service_class && SERVICE_CLASSES.includes(row.service_class)
    ? row.service_class
    : "standard";
  return {
    cardId: row.card_id,
    title: row.title,
    dueDate: row.due_date ?? "",
    assigneeUserIds,
    projectId: row.project_id,
    projectName: row.project_name,
    boardId: row.board_id,
    boardName: row.board_name,
    blocked: Boolean(row.blocked),
    serviceClass,
  };
}

/** 展開範圍內 active 專案的 active 看板；以 updated_at 取前 MAX_CALENDAR_BOARDS 個。
 *  卡片藏在 boards.data 的 JSON blob 裡，因此用 json_each 在 SQL 層展開與過濾——
 *  已實測 D1 支援（見規格 §3.1），避免把整份 board JSON 拉進 Worker。 */
function cardQuery(projectPlaceholders: string, dueClause: string, limit: number): string {
  return `SELECT projects.id AS project_id, projects.name AS project_name,
                 boards.id AS board_id, boards.name AS board_name,
                 cards.key AS card_id,
                 json_extract(cards.value, '$.title') AS title,
                 json_extract(cards.value, '$.dueDate') AS due_date,
                 json_extract(cards.value, '$.blocked') AS blocked,
                 json_extract(cards.value, '$.serviceClass') AS service_class,
                 json_extract(cards.value, '$.assigneeUserIds') AS assignee_ids
          FROM boards
          INNER JOIN projects ON projects.id = boards.project_id
          JOIN json_each(json_extract(boards.data, '$.cards')) AS cards
          WHERE boards.id IN (
                  SELECT boards.id FROM boards
                  WHERE boards.status = 'active'
                    AND boards.project_id IN (${projectPlaceholders})
                  ORDER BY boards.updated_at DESC, boards.id DESC
                  LIMIT ${MAX_CALENDAR_BOARDS}
                )
            AND json_extract(cards.value, '$.completedAt') IS NULL
            AND ${dueClause}
          ORDER BY due_date, projects.name COLLATE NOCASE, title
          LIMIT ${limit}`;
}

export async function handleCalendarRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (url.pathname !== "/calendar") return null;
  if (context.request.method !== "GET") return null;
  await requireMigrationComplete(context.env.DB);

  const workspaceId = parseUuid(url.searchParams.get("workspaceId"), "workspace_id");
  const month = url.searchParams.get("month") ?? "";
  if (!MONTH_PATTERN.test(month)) throw new RequestError(400, "invalid_month");

  const scope = await resolveCalendarScope(context.env.DB, context.user.id, workspaceId);
  if (!scope.projectIds.length) {
    return json(200, {
      month, scope: scope.kind, scheduled: [], unscheduled: [],
      unscheduledTruncated: false, boardsTruncated: false, assignees: [],
      requestId: context.requestId,
    }, context.requestId);
  }

  const placeholders = scope.projectIds.map(() => "?").join(", ");
  const boardCount = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM boards
     WHERE boards.status = 'active' AND boards.project_id IN (${placeholders})`,
  ).bind(...scope.projectIds).first<number>("n") ?? 0;

  const scheduledResult = await context.env.DB.prepare(
    cardQuery(placeholders, "json_extract(cards.value, '$.dueDate') LIKE ?", 5000),
  ).bind(...scope.projectIds, ...scope.projectIds, `${month}-%`).all<CardRow>();

  const unscheduledResult = await context.env.DB.prepare(
    cardQuery(
      placeholders,
      "(json_extract(cards.value, '$.dueDate') IS NULL OR json_extract(cards.value, '$.dueDate') = '')",
      MAX_UNSCHEDULED + 1,
    ),
  ).bind(...scope.projectIds, ...scope.projectIds).all<CardRow>();

  const scheduled = scheduledResult.results.map(toCalendarCard);
  const unscheduledAll = unscheduledResult.results.map(toCalendarCard);
  const unscheduledTruncated = unscheduledAll.length > MAX_UNSCHEDULED;
  const unscheduled = unscheduledAll.slice(0, MAX_UNSCHEDULED);

  const userIds = [...new Set(
    [...scheduled, ...unscheduled].flatMap((card) => card.assigneeUserIds),
  )];
  let assignees: Array<{ userId: string; displayName: string }> = [];
  if (userIds.length) {
    const namePlaceholders = userIds.map(() => "?").join(", ");
    const directory = await context.env.DB.prepare(
      `SELECT id, display_name FROM user_accounts WHERE id IN (${namePlaceholders})`,
    ).bind(...userIds).all<{ id: string; display_name: string }>();
    assignees = directory.results.map((row) => ({
      userId: row.id,
      displayName: row.display_name,
    }));
  }

  return json(200, {
    month,
    scope: scope.kind,
    scheduled,
    unscheduled,
    unscheduledTruncated,
    boardsTruncated: boardCount > MAX_CALENDAR_BOARDS,
    assignees,
    requestId: context.requestId,
  }, context.requestId);
}
```

**注意 bind 順序**：`cardQuery` 的 `projectPlaceholders` 出現**兩次**（外層 JOIN 的 projects
與內層 board 子查詢），所以要 bind 兩份 `scope.projectIds` 再接 dueClause 的參數——照上面
的寫法即可，不要少一份。

- [ ] **Step 4: 掛上路由**

`worker-sync/src/router.ts` 的 `ROUTES` 陣列加入（放在 `handleUserRequest` 之後、
`handleMemberBoardsRequest` 之前即可，`/calendar` 路徑與其他 handler 無前綴衝突）：

```ts
  { capability: "authenticated", handle: handleCalendarRequest },
```

並在 import 區加入 `import { handleCalendarRequest } from "./calendar";`。

- [ ] **Step 5: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/calendar.integration.test.ts
pnpm worker:test
pnpm worker:types:check
```

- [ ] **Step 6: Commit**

```bash
git add worker-sync/src/calendar.ts worker-sync/src/router.ts worker-sync/test/calendar.integration.test.ts
git commit -m "feat: add cross-project calendar endpoint"
```

### Task 3: Client — 型別、API 與路由

**Files:**
- Modify: `app/projects/types.ts`
- Modify: `app/projects/api.ts`
- Modify: `app/projects/navigation.ts`
- Test: `tests/project-api.test.ts`（附加）
- Test: `tests/project-navigation.test.ts`（附加）

**Interfaces:**
- Consumes: Task 2 的端點。
- Produces（Task 4／5 使用）：
  - `CalendarCard = { cardId: string; title: string; dueDate: string; assigneeUserIds: string[]; projectId: string; projectName: string; boardId: string; boardName: string; blocked: boolean; serviceClass: ServiceClass }`
  - `CalendarData = { month: string; scope: "workspace" | "owned_projects"; scheduled: CalendarCard[]; unscheduled: CalendarCard[]; unscheduledTruncated: boolean; boardsTruncated: boolean; assignees: Array<{ userId: string; displayName: string }> }`
  - `getCalendar(config: SyncConfig, workspaceId: string, month: string): Promise<CalendarData>`
  - 路由 `{ kind: "calendar"; month: string | null }`

- [ ] **Step 1: 寫失敗測試**

`tests/project-api.test.ts` 附加（沿用該檔既有 fetch stub 與斷言風格）：

1. `getCalendar` 對完整回應解析出 `scheduled`／`unscheduled`／旗標／`assignees`；
   請求 URL 為 `/calendar?workspaceId=<w>&month=2026-08`、method GET。
2. 回應缺 `scheduled`、或某筆 `serviceClass` 為未知值時 throw `ApiClientError`
   且 `kind === "invalid_response"`（沿用該檔既有 `invalidResponse` 斷言風格）。

`tests/project-navigation.test.ts` 附加：

3. `parseProjectRoute("#/calendar")` 回 `{ kind: "calendar", month: null }`；
   `parseProjectRoute("#/calendar?month=2026-08")` 回 `{ kind: "calendar", month: "2026-08" }`；
   月份格式不合法（`#/calendar?month=2026-13`）時 `month` 為 `null`（不要拋錯，退回預設月）。
4. `serializeProjectRoute({ kind: "calendar", month: "2026-08" })` 回 `"#/calendar?month=2026-08"`；
   `month` 為 null 時回 `"#/calendar"`。
5. `resolveAuthorizedRoute` 對 `{ kind: "calendar" }` 在 `allowAdmin` 為 false 時導回
   `{ kind: "projects" }`，為 true 時原樣回傳（沿用既有 `admin` 路由的處理方式）。

- [ ] **Step 2: 執行確認失敗**

```bash
pnpm exec tsx --test tests/project-api.test.ts tests/project-navigation.test.ts
```

- [ ] **Step 3: 加型別**

`app/projects/types.ts`（放在既有 `BoardMeta` 附近）：

```ts
/** 日曆檢視的卡片投影；刻意不含描述、checklist、附件與阻塞原因。 */
export type CalendarCard = {
  cardId: string;
  title: string;
  /** date-only `YYYY-MM-DD`；未排程卡為空字串。 */
  dueDate: string;
  assigneeUserIds: string[];
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
  blocked: boolean;
  serviceClass: ServiceClass;
};

export type CalendarData = {
  month: string;
  scope: "workspace" | "owned_projects";
  scheduled: CalendarCard[];
  unscheduled: CalendarCard[];
  unscheduledTruncated: boolean;
  boardsTruncated: boolean;
  assignees: Array<{ userId: string; displayName: string }>;
};
```

`ServiceClass` 從 `app/board-model.ts` re-export 或直接 import——先 grep 該型別在
`app/projects/types.ts` 是否已可用，若否則 `import type { ServiceClass } from "../board-model";`。

- [ ] **Step 4: 加 parser 與 API 函式**

`app/projects/api.ts`（放在 `listAdminUserProjects` 之後，沿用該檔既有的 `asRecord`／
`invalidResponse`／`isServiceClass` 等 helper——**先 grep 確認 `isServiceClass` 是否已存在
於 `app/projects/model.ts` 或 `board-model.ts` 並 import，不要重新實作字面比對**）：

```ts
function parseCalendarCard(value: unknown): CalendarCard | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const cardId = typeof raw.cardId === "string" ? raw.cardId : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  const dueDate = typeof raw.dueDate === "string" ? raw.dueDate : "";
  const projectId = typeof raw.projectId === "string" ? raw.projectId : "";
  const projectName = typeof raw.projectName === "string" ? raw.projectName : "";
  const boardId = typeof raw.boardId === "string" ? raw.boardId : "";
  const boardName = typeof raw.boardName === "string" ? raw.boardName : "";
  if (!cardId || !title || !projectId || !boardId) return null;
  if (!isServiceClass(raw.serviceClass)) return null;
  const assignees = Array.isArray(raw.assigneeUserIds)
    ? raw.assigneeUserIds.filter((id): id is string => typeof id === "string")
    : null;
  if (!assignees) return null;
  return {
    cardId, title, dueDate,
    assigneeUserIds: assignees,
    projectId, projectName, boardId, boardName,
    blocked: raw.blocked === true,
    serviceClass: raw.serviceClass,
  };
}

function parseCalendarCardList(value: unknown, operation: string): CalendarCard[] {
  if (!Array.isArray(value)) throw invalidResponse(operation);
  const cards = value.map(parseCalendarCard);
  if (cards.some((card) => card === null)) throw invalidResponse(operation);
  return cards as CalendarCard[];
}

export async function getCalendar(
  config: SyncConfig,
  workspaceId: string,
  month: string,
): Promise<CalendarData> {
  assertResourceId(workspaceId, "workspace_id");
  const operation = "讀取日曆";
  const query = new URLSearchParams({ workspaceId, month });
  const raw = asRecord(await requestJson(config, `/calendar?${query}`, operation));
  if (!raw) throw invalidResponse(operation);
  const scope = raw.scope === "workspace" || raw.scope === "owned_projects"
    ? raw.scope
    : null;
  if (typeof raw.month !== "string" || !scope) throw invalidResponse(operation);
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees.map((entry) => {
        const row = asRecord(entry);
        return row && typeof row.userId === "string" && typeof row.displayName === "string"
          ? { userId: row.userId, displayName: row.displayName }
          : null;
      })
    : null;
  if (!assignees || assignees.some((entry) => entry === null)) {
    throw invalidResponse(operation);
  }
  return {
    month: raw.month,
    scope,
    scheduled: parseCalendarCardList(raw.scheduled, operation),
    unscheduled: parseCalendarCardList(raw.unscheduled, operation),
    unscheduledTruncated: raw.unscheduledTruncated === true,
    boardsTruncated: raw.boardsTruncated === true,
    assignees: assignees as Array<{ userId: string; displayName: string }>,
  };
}
```

- [ ] **Step 5: 加路由**

`app/projects/navigation.ts`：

- `ProjectRoute` 聯集加入 `| { kind: "calendar"; month: string | null }`。
- `parseProjectRoute`：在 `if (path === "admin")` 之後加入——注意 hash 可能帶 query，
  先讀該函式現有的字串處理方式再對接：

```ts
  if (path === "calendar" || path.startsWith("calendar?")) {
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    const month = new URLSearchParams(query).get("month");
    return {
      kind: "calendar",
      month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    };
  }
```

- `serializeProjectRoute`：加入

```ts
  if (route.kind === "calendar") {
    return route.month ? `#/calendar?month=${route.month}` : "#/calendar";
  }
```

- `resolveAuthorizedRoute`：把 `calendar` 與 `admin` 同樣處理（`allowAdmin` 為 false 時
  導回 `{ kind: "projects" }`）：

```ts
  if (route?.kind === "calendar") {
    return allowAdmin ? route : { kind: "projects" };
  }
```

- [ ] **Step 6: 執行至通過**

```bash
pnpm exec tsx --test tests/project-api.test.ts tests/project-navigation.test.ts
pnpm test
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add app/projects/types.ts app/projects/api.ts app/projects/navigation.ts tests/project-api.test.ts tests/project-navigation.test.ts
git commit -m "feat: add calendar client API and route"
```

### Task 4: Client — 日曆純函式模組

**Files:**
- Create: `app/projects/calendar-model.ts`
- Test: `tests/calendar-model.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `CalendarCard`。
- Produces（Task 5 使用）：
  - `monthGrid(month: string): Array<{ date: string; inMonth: boolean }>`
  - `monthLabel(month: string): string`
  - `shiftMonth(month: string, delta: number): string`
  - `currentMonth(today?: Date): string`
  - `todayString(today?: Date): string`（本地日期 `YYYY-MM-DD`，供 UI 判定今天與逾期）
  - `groupCardsByDueDate(cards: CalendarCard[]): Record<string, CalendarCard[]>`
  - `assigneeLoad(cards: CalendarCard[], assignees: Array<{ userId: string; displayName: string }>): { entries: Array<{ userId: string; displayName: string; count: number }>; unassignedCount: number }`
  - `isOverdue(dueDate: string, today: string): boolean`

UI 元件在本專案沒有測試 harness，所以把可測的邏輯全部抽到這個純函式模組，元件只負責渲染。

- [ ] **Step 1: 寫失敗測試**

`tests/calendar-model.test.ts`（node:test，沿用 `tests/board-model.test.ts` 的 import 與
斷言風格）：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  assigneeLoad,
  currentMonth,
  groupCardsByDueDate,
  todayString,
  isOverdue,
  monthGrid,
  monthLabel,
  shiftMonth,
  type CalendarGridCell,
} from "../app/projects/calendar-model";
import type { CalendarCard } from "../app/projects/types";

function card(overrides: Partial<CalendarCard> & Pick<CalendarCard, "cardId">): CalendarCard {
  return {
    cardId: overrides.cardId,
    title: overrides.title ?? "任務",
    dueDate: overrides.dueDate ?? "",
    assigneeUserIds: overrides.assigneeUserIds ?? [],
    projectId: overrides.projectId ?? "p1",
    projectName: overrides.projectName ?? "專案",
    boardId: overrides.boardId ?? "b1",
    boardName: overrides.boardName ?? "看板",
    blocked: overrides.blocked ?? false,
    serviceClass: overrides.serviceClass ?? "standard",
  };
}

test("monthGrid 以週日起始並補滿完整週", () => {
  // 2026-08-01 是週六 → 前面補 6 格（週日到週五屬於 7 月）
  const grid = monthGrid("2026-08");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0].date, "2026-07-26");
  assert.equal(grid[0].inMonth, false);
  const inMonth = grid.filter((cell) => cell.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[0].date, "2026-08-01");
  assert.equal(inMonth[30].date, "2026-08-31");
  assert.equal(grid[grid.length - 1].inMonth, false);
});

test("monthGrid 處理閏年二月", () => {
  const grid = monthGrid("2028-02");
  assert.equal(grid.filter((cell) => cell.inMonth).length, 29);
});

test("shiftMonth 跨年前後移動", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-08", 0), "2026-08");
});

test("monthLabel 使用繁中格式", () => {
  assert.equal(monthLabel("2026-08"), "2026 年 8 月");
});

test("currentMonth 依本地日期回傳 YYYY-MM", () => {
  assert.equal(currentMonth(new Date(2026, 7, 12)), "2026-08");
});

test("todayString 回傳本地日期字串", () => {
  assert.equal(todayString(new Date(2026, 7, 3)), "2026-08-03");
});

test("groupCardsByDueDate 依日期分組且略過未排程卡", () => {
  const grouped = groupCardsByDueDate([
    card({ cardId: "a", dueDate: "2026-08-14" }),
    card({ cardId: "b", dueDate: "2026-08-14" }),
    card({ cardId: "c", dueDate: "" }),
  ]);
  assert.deepEqual(grouped["2026-08-14"].map((entry) => entry.cardId), ["a", "b"]);
  assert.equal(Object.keys(grouped).length, 1);
});

test("assigneeLoad 統計每人件數與未指派卡數", () => {
  const load = assigneeLoad(
    [
      card({ cardId: "a", assigneeUserIds: ["u1"] }),
      card({ cardId: "b", assigneeUserIds: ["u1", "u2"] }),
      card({ cardId: "c", assigneeUserIds: [] }),
    ],
    [
      { userId: "u1", displayName: "阿明" },
      { userId: "u2", displayName: "小華" },
    ],
  );
  assert.deepEqual(load.entries, [
    { userId: "u1", displayName: "阿明", count: 2 },
    { userId: "u2", displayName: "小華", count: 1 },
  ]);
  assert.equal(load.unassignedCount, 1);
});

test("assigneeLoad 對目錄查不到的 userId 以短 ID 呈現", () => {
  const load = assigneeLoad([card({ cardId: "a", assigneeUserIds: ["deadbeef-1111"] })], []);
  assert.equal(load.entries.length, 1);
  assert.equal(load.entries[0].displayName, "deadbeef");
});

test("isOverdue 只在截止日早於今天時為真", () => {
  assert.equal(isOverdue("2026-08-11", "2026-08-12"), true);
  assert.equal(isOverdue("2026-08-12", "2026-08-12"), false);
  assert.equal(isOverdue("", "2026-08-12"), false);
});
```

- [ ] **Step 2: 執行確認失敗**

```bash
pnpm exec tsx --test tests/calendar-model.test.ts
```

預期：FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`app/projects/calendar-model.ts`：

```ts
import type { CalendarCard } from "./types";

export type CalendarGridCell = { date: string; inMonth: boolean };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
}

/** 覆蓋整個月份的日曆格子，週日起始並補滿完整週（符合多數 zh-TW 日曆慣例）。 */
export function monthGrid(month: string): CalendarGridCell[] {
  const { year, monthIndex } = monthParts(month);
  const first = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - first.getDay());
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const totalCells = Math.ceil((first.getDay() + lastDay) / 7) * 7;
  const cells: CalendarGridCell[] = [];
  for (let offset = 0; offset < totalCells; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    cells.push({
      date: localDateString(date),
      inMonth: date.getMonth() === monthIndex && date.getFullYear() === year,
    });
  }
  return cells;
}

export function monthLabel(month: string): string {
  const { year, monthIndex } = monthParts(month);
  return `${year} 年 ${monthIndex + 1} 月`;
}

export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = monthParts(month);
  const shifted = new Date(year, monthIndex + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

export function currentMonth(today = new Date()): string {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

/** 本地日期字串；UI 用它判定「今天」的格子與逾期比較。 */
export function todayString(today = new Date()): string {
  return localDateString(today);
}

export function groupCardsByDueDate(cards: CalendarCard[]): Record<string, CalendarCard[]> {
  const grouped: Record<string, CalendarCard[]> = {};
  for (const card of cards) {
    if (!card.dueDate) continue;
    const list = grouped[card.dueDate];
    if (list) list.push(card);
    else grouped[card.dueDate] = [card];
  }
  return grouped;
}

export function assigneeLoad(
  cards: CalendarCard[],
  assignees: Array<{ userId: string; displayName: string }>,
): {
  entries: Array<{ userId: string; displayName: string; count: number }>;
  unassignedCount: number;
} {
  const names = new Map(assignees.map((entry) => [entry.userId, entry.displayName]));
  const counts = new Map<string, number>();
  let unassignedCount = 0;
  for (const card of cards) {
    if (!card.assigneeUserIds.length) {
      unassignedCount += 1;
      continue;
    }
    for (const userId of card.assigneeUserIds) {
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()]
    .map(([userId, count]) => ({
      userId,
      // 已離開 workspace 的成員不在目錄中，沿用既有慣例以短 ID 呈現。
      displayName: names.get(userId) ?? userId.slice(0, 8),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, "zh-Hant"));
  return { entries, unassignedCount };
}

export function isOverdue(dueDate: string, today: string): boolean {
  return Boolean(dueDate) && dueDate < today;
}
```

- [ ] **Step 4: 執行至通過**

```bash
pnpm exec tsx --test tests/calendar-model.test.ts
pnpm test
pnpm typecheck
```

若 `monthGrid` 的測試因起始日推算而失敗，先用 `node -e` 確認 `new Date(2026, 7, 1).getDay()`
的實際值再調整——不要為了讓測試通過而改斷言中的日期，那是規格行為。

- [ ] **Step 5: Commit**

```bash
git add app/projects/calendar-model.ts tests/calendar-model.test.ts
git commit -m "feat: add calendar grid and workload helpers"
```

### Task 5: Client — 日曆檢視畫面與入口

**Files:**
- Create: `app/components/projects/CalendarView.tsx`
- Modify: `app/components/projects/WorkspaceEntryNav.tsx`
- Modify: `app/components/projects/MyProjectsView.tsx`
- Modify: `app/components/projects/AdminProjectsView.tsx`
- Modify: `app/components/projects/ProjectApp.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 3 的 `getCalendar`／`CalendarData`／路由；Task 4 的全部純函式。

- [ ] **Step 1: 導覽列加入日曆入口**

`WorkspaceEntryNav.tsx` 的 `current` 型別由 `"projects" | "admin"` 改為
`"projects" | "admin" | "calendar"`，並在 `showAdmin` 區塊內加入（與平台管理同樣的
管理者 gating）：

```tsx
        {showAdmin && (
          <a
            href="#/calendar"
            className={current === "calendar" ? "active" : ""}
            aria-current={current === "calendar" ? "page" : undefined}
          >
            <strong>日曆</strong>
            <small>本月可推進的任務</small>
          </a>
        )}
```

`MyProjectsView.tsx` 與 `AdminProjectsView.tsx` 目前傳 `current="projects"`／`"admin"`，
不需改動（型別放寬是相容的）——但要確認 TypeScript 沒有因聯集擴張而報錯。

- [ ] **Step 2: 建立 CalendarView 元件**

`app/components/projects/CalendarView.tsx`。props：

```tsx
{
  config: SyncConfig;
  workspaceId: string;
  month: string;
  userName: string;
  onSignOut: () => void;
}
```

行為：

- 以 `useEffect` 呼叫 `getCalendar(config, workspaceId, month)`，`cancelled` 旗標防止
  卸載後 setState（沿用 `ProjectApp` 既有寫法）。
- 載入中顯示「讀取日曆…」；失敗顯示 `notice readOnlyNotice` 的錯誤訊息。
- 頂部 `WorkspaceEntryNav current="calendar"`。
- **月份切換**：上月／本月／下月三顆按鈕，用 `shiftMonth`／`currentMonth` 算出目標月份後
  `window.location.hash = serializeProjectRoute({ kind: "calendar", month: next })`。
  標題用 `monthLabel(month)`。
- **月曆格子**：`monthGrid(month)` 產生格子；每格用 `groupCardsByDueDate(data.scheduled)`
  取當日卡片。格子顯示日期數字、當日件數，以及每張卡的標題、專案名與指派人名稱
  （指派人以 `data.assignees` 對照，查不到用 `userId.slice(0, 8)`）。
  今天（`todayString()`）的格子加 `today` class。非本月格子加 `outside` class。
- **三種狀態的文字＋樣式雙重區隔**（規格硬性要求，不可只靠顏色）：
  - 逾期（`isOverdue(card.dueDate, today)`）：卡片加 `overdue` class **並**顯示「已逾期」文字。
  - 阻塞（`card.blocked`）：加 `blockedCard` class **並**顯示「卡住」文字。
  - 加急（`card.serviceClass === "expedite"`）：加 `expedite` class **並**顯示「加急」徽章。
- **側欄**：
  - 未排程池：列出 `data.unscheduled`（標題、專案名、指派人）；`unscheduledTruncated` 為
    true 時顯示「僅顯示前 200 筆未排程任務」。
  - 每人本月件數：`assigneeLoad(data.scheduled, data.assignees)` 的 `entries`，另單獨一列
    顯示「未指派 N 張」（`unassignedCount`）。
- `boardsTruncated` 為 true 時，在頁面頂部顯示 `notice` 提示「看板數量超過 50 個，僅統計最近
  更新的 50 個看板」。
- 空狀態：`data.scheduled` 為空時，月曆下方顯示「本月沒有排定的任務」並提示查看未排程池。
- **窄視窗引導**：元件恆渲染一個 `calendarNarrowNotice` 區塊（內容
  「日曆檢視需要較寬的畫面，請在桌面瀏覽器使用。」）與月曆主體，由 CSS 依 900 px 斷點
  互斥顯示——不用 JS 判斷寬度。

關鍵結構的骨架（其餘細節依上述行為要求自行補齊，class 名稱必須與 Step 4 的 CSS 一致）：

```tsx
  const today = todayString();
  const grid = monthGrid(month);
  const byDate = groupCardsByDueDate(data.scheduled);
  const load = assigneeLoad(data.scheduled, data.assignees);
  const nameOf = (userId: string) =>
    data.assignees.find((entry) => entry.userId === userId)?.displayName
      ?? userId.slice(0, 8);

  return (
    <main className="calendarShell">
      <WorkspaceEntryNav
        current="calendar"
        userName={userName}
        showAdmin
        onSignOut={onSignOut}
      />

      <p className="calendarNarrowNotice">
        日曆檢視需要較寬的畫面，請在桌面瀏覽器使用。
      </p>

      <div className="calendarLayout">
        <section aria-label="月曆">
          <header className="calendarHeader">
            <h1>{monthLabel(month)}</h1>
            <div className="calendarNav">
              <a href={serializeProjectRoute({ kind: "calendar", month: shiftMonth(month, -1) })}>
                上月
              </a>
              <a href={serializeProjectRoute({ kind: "calendar", month: currentMonth() })}>
                本月
              </a>
              <a href={serializeProjectRoute({ kind: "calendar", month: shiftMonth(month, 1) })}>
                下月
              </a>
            </div>
          </header>

          {data.boardsTruncated && (
            <p className="notice" role="alert">
              看板數量超過 50 個，僅統計最近更新的 50 個看板。
            </p>
          )}

          <div className="calendarWeekdays" aria-hidden="true">
            {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="calendarGrid">
            {grid.map((cell) => {
              const cards = byDate[cell.date] ?? [];
              const classes = ["calendarCell"];
              if (!cell.inMonth) classes.push("outside");
              if (cell.date === today) classes.push("today");
              return (
                <div key={cell.date} className={classes.join(" ")}>
                  <div className="calendarCellHead">
                    <span>{Number(cell.date.slice(8))}</span>
                    {cards.length > 0 && <small>{cards.length} 張</small>}
                  </div>
                  {cards.map((card) => {
                    const cardClasses = ["calendarCard"];
                    if (isOverdue(card.dueDate, today)) cardClasses.push("overdue");
                    if (card.blocked) cardClasses.push("blockedCard");
                    if (card.serviceClass === "expedite") cardClasses.push("expedite");
                    return (
                      <article key={card.cardId} className={cardClasses.join(" ")}>
                        <strong>{card.title}</strong>
                        <small>{card.projectName}</small>
                        {card.assigneeUserIds.length > 0 && (
                          <small>{card.assigneeUserIds.map(nameOf).join("、")}</small>
                        )}
                        <span className="calendarFlags">
                          {isOverdue(card.dueDate, today) && <span>已逾期</span>}
                          {card.blocked && <span>卡住</span>}
                          {card.serviceClass === "expedite" && <span>加急</span>}
                        </span>
                      </article>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {data.scheduled.length === 0 && (
            <p className="calendarEmpty">本月沒有排定的任務；可從右側未排程池挑選要推進的工作。</p>
          )}
        </section>

        <aside className="calendarSidebar" aria-label="未排程與人力負擔">
          {/* 未排程池與每人件數依上述行為要求渲染；
              unscheduledTruncated 為 true 時顯示「僅顯示前 200 筆未排程任務」，
              每人件數之後另列「未指派 {load.unassignedCount} 張」。 */}
        </aside>
      </div>
    </main>
  );
```

- [ ] **Step 3: 接進 ProjectApp**

`ProjectApp.tsx` 在 `if (route.kind === "admin")` 之後加入：

```tsx
  if (route.kind === "calendar") {
    const workspaceId = administrativeWorkspaces(bootstrap.session)[0]?.workspaceId ?? "";
    return (
      <CalendarView
        config={bootstrap.config}
        workspaceId={workspaceId}
        month={route.month ?? currentMonth()}
        userName={bootstrap.session.user.displayName}
        onSignOut={() => void signOut()}
      />
    );
  }
```

`administrativeWorkspaces` 在 `app/projects/session.ts`（先 grep 確認 export 名稱與回傳
形狀，`hasPlatformAdminAccess` 就是用它實作的）。`workspaceId` 為空字串時 `getCalendar` 的
`assertResourceId` 會擋下並顯示錯誤——這是可接受的降級，但要在報告記錄；此路由只有
`allowAdmin` 為 true 才會到達，理論上必有至少一個 administrative workspace。

同時把 `resolveAuthorizedRoute` 的呼叫處確認已傳 `allowAdmin`（既有 `admin` 路由已如此，
grep `resolveAuthorizedRoute(` 確認）。

- [ ] **Step 4: CSS**

`app/globals.css` 追加。沿用檔內既有的 CSS 變數（`--rose`／`--amber`／`--indigo`／
`--muted`，先 grep `:root` 確認可用者），**不要新增色彩變數**：

- `.calendarShell`：頁面容器，與 `.projectShell` 同樣的置中與最大寬度慣例。
- `.calendarGrid`：`display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px;`
- `.calendarWeekdays`：同樣七欄，顯示日～六。
- `.calendarCell`：`min-height: 96px;` 邊框與圓角沿用 `.card` 慣例；`.outside` 降低不透明度；
  `.today` 加明顯邊框。
- `.calendarCard`：小尺寸卡片；`.overdue`／`.blockedCard`／`.expedite` 各自的樣式。
- `.calendarSidebar`：與月曆並排（`display: grid; grid-template-columns: minmax(0, 1fr) 280px;`
  放在 `.calendarLayout`）。
- **900 px 斷點**：

```css
.calendarNarrowNotice { display: none; }

@media (max-width: 899px) {
  .calendarLayout { display: none; }
  .calendarNarrowNotice { display: block; }
}
```

- [ ] **Step 5: 驗證**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

全綠。UI 元件無測試 harness，行為由 Task 6 的人工驗收清單覆蓋。

- [ ] **Step 6: Commit**

```bash
git add app/components/projects/CalendarView.tsx app/components/projects/WorkspaceEntryNav.tsx app/components/projects/MyProjectsView.tsx app/components/projects/AdminProjectsView.tsx app/components/projects/ProjectApp.tsx app/globals.css
git commit -m "feat: add cross-project calendar view"
```

### Task 6: 文件與完整品質關卡

**Files:**
- Modify: `README.md`
- Modify: `NextTasks.md`

- [ ] **Step 1: README**

「功能」清單加入一行：

```markdown
- 管理者專屬的跨專案日曆檢視：依截止日呈現本月任務、未排程池與每人件數（桌面專用）。
```

「Project／Board 與同步行為」清單加入一行（記錄第二次刻意的邊界放寬）：

```markdown
- workspace owner／admin 可透過日曆端點讀取整個 workspace 所有 active 專案的卡片標題、
  截止日與指派人；放寬限定在該端點，board content、附件與 Activity Log 仍需加入專案才能讀。
```

- [ ] **Step 2: NextTasks**

「目前真實狀態」表新增一列：

```markdown
| 跨專案日曆檢視 v1 | 已實作，待 staging 部署與驗收 | 管理者專屬 `GET /calendar?workspaceId=&month=`；workspace owner／admin 得到全 workspace active 專案、Project owner 得到他 own 的、其餘 403；只回未完成卡與 active 看板，不含描述／checklist／附件／阻塞原因；卡片以 SQLite `json_each` 在 SQL 層過濾（D1 已實測支援）；未排程池上限 200、看板上限 50，超出以旗標明示；v1 純檢視、桌面專用（< 900 px 顯示引導訊息） |
```

P0-4 驗收清單新增：

```markdown
- [ ] workspace admin 的日曆含全 workspace 所有 active 專案的本月卡片。
- [ ] Project owner 只看到他 own 的專案；member 與 viewer 開 `#/calendar` 被導回「我的專案」。
- [ ] member 直接呼叫 `/calendar` 端點得到 403，無法藉此讀取未指派看板的卡片。
- [ ] 逾期、阻塞、加急三種卡片同時有文字與樣式區隔。
- [ ] 未排程池顯示無截止日的卡片；超過 200 筆時明示已截斷。
- [ ] 側欄的每人件數與未指派卡數正確。
- [ ] 月份切換更新 URL，且以 `#/calendar?month=YYYY-MM` 直接開啟可重載該月。
- [ ] 已完成卡、archived 專案與 archived 看板的卡片不出現。
- [ ] 視窗縮到 900 px 以下顯示引導訊息而非破版月曆。
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
pnpm sync:dry-run:staging
git diff --check
```

九項全部必須通過。任一失敗先判斷是本功能引入或既有問題：本功能引入的要修，既有問題
記錄於報告。

- [ ] **Step 4: Commit**

```bash
git add README.md NextTasks.md
git commit -m "docs: record cross-project calendar view"
```

## 部署備註（執行者不自行執行）

本功能無 D1 migration。部署由使用者決定時機：

1. `pnpm sync:deploy:staging`
2. `pnpm web:deploy:beta`

行動版不需重建（日曆為桌面專用，且 mobile bundle 與 Web 共用同一份程式碼——下次 mobile
build 會自然帶入，窄視窗會顯示引導訊息）。production 不在本次範圍（見 NextTasks P0-5）。
