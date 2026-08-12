# 從使用者管理指派專案成員 v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 workspace owner／admin 在平台管理的「使用者管理」畫面，以使用者為主軸指派他參與哪些專案與角色。

**Architecture:** 不修改 `authorizeProject`（它守著所有 manage 操作），而是在 `memberships.ts` 內新增一條並行授權路徑，只放寬 membership 的 PUT／DELETE：專案 owner 或 workspace owner／admin 皆可。新增一個 admin-only 的 `GET /admin/users/:userId/projects` 提供以使用者為主軸的 membership 清單，UI 以獨立 modal 呈現（即時生效、樂觀更新），與既有表單語意的「管理」modal 分開。

**Tech Stack:** Cloudflare Workers、D1（SQLite）、vitest-pool-workers integration tests、React 19／vinext、node:test（client 單元測試）。

## Global Constraints

- 角色命名：D1 存 `manager`（＝產品 owner）、`contributor`（＝產品 member）、`viewer`（legacy 唯讀）；對外以 `toPublicProjectRole` 轉為 `owner`／`member`／`viewer`。
- **放寬只作用於 `PUT`／`DELETE /projects/:projectId/members/:userId`**。`authorizeProject` 本身不得修改；其餘 manage 操作（專案改名／封存、看板建立／改名／封存、工作流欄位、看板指派）行為必須完全不變。
- `viaPlatformAdmin` 的判定（本計畫的權威定義）：**呼叫者不具專案 `manage` capability，而是憑 workspace owner／admin 通過授權時為 true**。此時 audit metadata 加 `via: "platform_admin"`；呼叫者本身是專案 owner 時不加。（規格 §4 的「不是該專案的成員」是簡略說法；contributor 兼 workspace admin 走的仍是放寬路徑，應標記。）
- 既有保護一律沿用、**不得重寫**：last-owner guard（409 `last_owner`）、idempotency、mutation 與 audit 同批原子性。
- 錯誤碼慣例：`/admin/*` 對非 workspace admin 回 **404 `not_found`**（不洩漏端點存在）；目標使用者不在 workspace 回 **404 `user_not_found`**。
- 所有 UI 文案繁體中文。
- 測試不得硬編當月或當日字串。

---

### Task 1: Worker — 放寬 membership 授權與 audit `via` 標記

**Files:**
- Modify: `worker-sync/src/memberships.ts`
- Test: 既有 membership 測試所在檔（**先 grep 定位**：`grep -rln "membership.role_changed\|last_owner" worker-sync/test`；若散落多檔，附加到覆蓋 `PUT /projects/:id/members/:userId` 最完整的那一檔）

**Interfaces:**
- Produces（Task 2 之後不直接依賴，但驗收會用）：`PUT`／`DELETE /projects/:projectId/members/:userId` 接受 workspace owner／admin。

- [ ] **Step 1: 寫失敗測試**

沿用該測試檔既有的 helper 與 fixture 寫法（workspace／project／user／token 建立方式先讀該檔 beforeEach）。測試意圖：

1. workspace admin **未加入**某專案時，`PUT /projects/:p/members/:u` body `{"role":"member"}` 回 **200**，且該 membership 實際寫入 D1。
2. 同一操作在 `activity_logs` 產生 `membership.added`，metadata 含 `"via":"platform_admin"`。
3. 呼叫者是專案 owner（`manager`）時操作成功，且 metadata **不含** `via`。
4. 一般 `contributor`（非 workspace admin）呼叫 `PUT` 仍回 **403**。
5. 完全非成員且非 workspace admin 的使用者呼叫 `PUT` 回 **404**。
6. workspace admin 對非成員專案 `DELETE` 最後一位 owner 回 **409 `last_owner`**，且該 membership 仍存在。
7. workspace admin 自我指派（`targetUserId` ＝ 呼叫者自己）成功，且 log 的 `actor_user_id` 與 `entity_id` 相同。
8. **放寬不外溢**：同一位未加入專案的 workspace admin 對該專案 `GET /projects/:p/boards/:b/content` 仍回 404（維持既有行為）。
9. **idempotency 在放寬路徑下仍成立**（規格 §6 明列）：workspace admin 以相同 `role`
   連續兩次 `PUT` 都回 200，且 `activity_logs` 只多一筆（第二次為 no-op short-circuit，
   不產生第二筆 audit）；對非成員 `DELETE` 回 200 且不寫 audit。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts <測試檔路徑>
```

預期：意圖 1／2／6／7 FAIL（目前 workspace admin 得到 404）。

- [ ] **Step 3: 實作授權 helper**

在 `worker-sync/src/memberships.ts` 加入（import 區補上 `AuthorizationError`、`hasProjectCapability` 來自 `./authorization`，`WorkspaceRole` 來自 `./db-types`）：

```ts
type MembershipAuthorization = { viaPlatformAdmin: boolean };

/** membership 寫入的授權：專案 owner，或 workspace owner／admin（平台管理平面）。
 *  放寬只作用於本檔的 PUT／DELETE；其餘 manage 操作仍走 authorizeProject。 */
async function authorizeMembershipManagement(
  database: D1Database,
  userId: string,
  projectId: string,
): Promise<MembershipAuthorization> {
  const row = await database.prepare(
    `SELECT workspace_members.role AS workspace_role,
            project_members.role AS project_role
     FROM projects
     LEFT JOIN workspace_members
       ON workspace_members.workspace_id = projects.workspace_id
      AND workspace_members.user_id = ?
     LEFT JOIN project_members
       ON project_members.project_id = projects.id
      AND project_members.user_id = ?
     WHERE projects.id = ?`,
  ).bind(userId, userId, projectId).first<{
    workspace_role: WorkspaceRole | null;
    project_role: ProjectRole | null;
  }>();
  if (!row) throw new AuthorizationError(404, "not_found");
  if (hasProjectCapability(row.project_role, "manage")) {
    return { viaPlatformAdmin: false };
  }
  if (row.workspace_role === "owner" || row.workspace_role === "admin") {
    return { viaPlatformAdmin: true };
  }
  // 既有行為：專案成員但權限不足回 403、非成員回 404（不洩漏專案存在）。
  if (row.project_role) throw new AuthorizationError(403, "forbidden");
  throw new AuthorizationError(404, "not_found");
}
```

- [ ] **Step 4: 接入 putMember 與 deleteMember**

`putMember` 開頭的
`await authorizeProject(context.env.DB, context.user.id, projectId, "manage");`
改為：

```ts
  const { viaPlatformAdmin } = await authorizeMembershipManagement(
    context.env.DB,
    context.user.id,
    projectId,
  );
```

該函式的 audit metadata 由 `{ from: current?.role ?? null, to: role }` 改為：

```ts
      {
        from: current?.role ?? null,
        to: role,
        ...(viaPlatformAdmin ? { via: "platform_admin" } : {}),
      },
```

`deleteMember` 做同樣的授權替換，audit metadata 由 `{ from: current.role }` 改為：

```ts
      {
        from: current.role,
        ...(viaPlatformAdmin ? { via: "platform_admin" } : {}),
      },
```

**不要改動** `listMembers`（`read`）與 `listMemberCandidates`（`manage`）的授權——規格 §7 明確把它們排除在本次範圍外。這會造成一個刻意的不對稱：未加入專案的 admin 能寫 membership 但不能讀該專案的成員清單。可以接受，因為 admin UI 是以使用者為主軸讀取（Task 2 的端點），不呼叫 `listMembers`。請在報告中記錄此不對稱。

- [ ] **Step 5: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts <測試檔路徑>
pnpm worker:test
pnpm worker:types:check
```

全綠。既有測試若因授權放寬而改變預期（例如原本斷言 admin 得到 404 的案例），先判斷該斷言是否正是本次刻意改變的行為；是則更新並在報告列出，否則視為回歸必須修正。

- [ ] **Step 6: Commit**

```bash
git add worker-sync/src/memberships.ts <測試檔路徑>
git commit -m "feat: let workspace admins manage project memberships"
```

### Task 2: Worker — `GET /admin/users/:userId/projects`

**Files:**
- Modify: `worker-sync/src/users.ts`
- Test: `worker-sync/test/users.integration.test.ts`

**Interfaces:**
- Produces（Task 3 對接）：`GET /admin/users/:userId/projects?workspaceId=<uuid>` →
  `{ userId, memberships: [{ projectId, projectName, role, status }], requestId }`；
  `role` 為對外值（`owner`／`member`／`viewer`），`status` 為 `active`／`archived`。

- [ ] **Step 1: 寫失敗測試**

附加到 `worker-sync/test/users.integration.test.ts`，沿用該檔既有 helper：

1. workspace admin 呼叫回 **200**，`memberships` 含該使用者參與的專案，`role` 為對外值
   （建立時以 D1 `manager` 寫入，回應應為 `"owner"`）。
2. 回應包含 **archived 專案**的 membership，且 `status` 為 `"archived"`。
3. 非 workspace admin（一般 workspace member）呼叫回 **404**。
4. 目標使用者不在該 workspace 回 **404 `user_not_found`**。
5. 該使用者沒有任何 membership 時回 200 且 `memberships` 為空陣列。

- [ ] **Step 2: 執行確認失敗**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/users.integration.test.ts
```

預期：全部 FAIL（路由不存在，落到 404 `not_found` 或其他 handler）。

- [ ] **Step 3: 實作 handler**

在 `worker-sync/src/users.ts` 加入（import 區按需補 `toPublicProjectRole`、`ProjectRole`、`ResourceStatus`，皆來自 `./db-types`）：

```ts
type UserProjectRow = {
  project_id: string;
  project_name: string;
  status: ResourceStatus;
  role: ProjectRole;
};

async function listUserProjects(
  context: ApiContext,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  await requireWorkspaceAdmin(context, workspaceId);
  await getTargetMembership(context, workspaceId, userId);
  const result = await context.env.DB.prepare(
    `SELECT projects.id AS project_id, projects.name AS project_name,
            projects.status AS status, project_members.role AS role
     FROM project_members
     INNER JOIN projects ON projects.id = project_members.project_id
     WHERE project_members.user_id = ? AND projects.workspace_id = ?
     ORDER BY projects.name COLLATE NOCASE, projects.id`,
  ).bind(userId, workspaceId).all<UserProjectRow>();
  return json(200, {
    userId,
    memberships: result.results.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      role: toPublicProjectRole(row.role),
      status: row.status,
    })),
    requestId: context.requestId,
  }, context.requestId);
}
```

- [ ] **Step 4: 掛上路由**

`handleUserRequest` 內的 regex
`/^\/admin\/users\/([0-9a-f-]+)(?:\/(password))?$/i`
改為
`/^\/admin\/users\/([0-9a-f-]+)(?:\/(password|projects))?$/i`，
並在既有的 `match[2] === "password"` 分支附近加入：

```ts
  if (match[2] === "projects" && context.request.method === "GET") {
    return listUserProjects(context, workspaceId, userId);
  }
```

`workspaceId` 沿用該函式既有的 `parseUuid(url.searchParams.get("workspaceId"), "workspace_id")`
（query 參數，不是路徑段）。**注意** `handleUserRequest` 在 `router.ts` 掛在第 2 位且以
`/admin/users` 前綴短路，因此不需調整 router 順序。

- [ ] **Step 5: 執行至通過**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec vitest run --config worker-sync/vitest.config.ts worker-sync/test/users.integration.test.ts
pnpm worker:test
pnpm worker:types:check
```

- [ ] **Step 6: Commit**

```bash
git add worker-sync/src/users.ts worker-sync/test/users.integration.test.ts
git commit -m "feat: list a user's project memberships for platform admins"
```

### Task 3: Client — 型別、parser 與 API 函式

**Files:**
- Modify: `app/projects/types.ts`
- Modify: `app/projects/api.ts`
- Test: `tests/project-api.test.ts`

**Interfaces:**
- Consumes: Task 2 的端點。
- Produces（Task 4 使用）：
  - `AdminUserProjectMembership = { projectId: string; projectName: string; role: ProjectRole; status: ResourceStatus }`
  - `listAdminUserProjects(config: SyncConfig, workspaceId: string, userId: string): Promise<AdminUserProjectMembership[]>`
- 既有可直接沿用（不要重寫）：
  - `setProjectMember(config, projectId, userId, role): Promise<ProjectMember>`（PUT）
  - `removeProjectMember(config, projectId, userId): Promise<void>`（DELETE）
  - `listAdminProjects(config): Promise<AdminProjectSummary[]>`

- [ ] **Step 1: 寫失敗測試**

附加到 `tests/project-api.test.ts`，沿用該檔既有 fetch stub 寫法：

1. `listAdminUserProjects` 對
   `{"userId":"<u>","memberships":[{"projectId":"<p>","projectName":"專案 A","role":"owner","status":"active"}],"requestId":"r"}`
   回傳一筆解析後的物件；請求 URL 為 `/admin/users/<u>/projects?workspaceId=<w>`、method 為 GET。
2. 回應缺 `memberships`、或 `memberships` 內某筆的 `role` 為未知值時，throw
   `ApiClientError` 且 `kind === "invalid_response"`（沿用該檔 `:441` 附近的既有斷言風格）。

- [ ] **Step 2: 執行確認失敗**

```bash
pnpm exec tsx --test tests/project-api.test.ts
```

- [ ] **Step 3: 加型別**

`app/projects/types.ts`（放在既有 `AdminUserSummary` 附近）：

```ts
/** 平台管理以使用者為主軸檢視的專案 membership。 */
export type AdminUserProjectMembership = {
  projectId: string;
  projectName: string;
  role: ProjectRole;
  status: ResourceStatus;
};
```

- [ ] **Step 4: 加 parser 與 API 函式**

先 `grep -n "function parseAdminUser" app/projects/api.ts app/projects/model.ts` 確認既有
admin parser 放在哪個檔，把新 parser 放在它旁邊，沿用該檔既有的 `asRecord`／
`invalidResponse` 慣例：

```ts
function parseAdminUserProjectMembership(
  value: unknown,
): AdminUserProjectMembership | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const projectId = typeof raw.projectId === "string" ? raw.projectId : "";
  const projectName = typeof raw.projectName === "string" ? raw.projectName : "";
  const { role, status } = raw;
  if (!projectId || !projectName) return null;
  if (role !== "owner" && role !== "member" && role !== "viewer") return null;
  if (status !== "active" && status !== "archived") return null;
  return { projectId, projectName, role, status };
}
```

API 函式放在 `app/projects/api.ts` 的 `resetAdminUserPassword` 之後：

```ts
export async function listAdminUserProjects(
  config: SyncConfig,
  workspaceId: string,
  userId: string,
): Promise<AdminUserProjectMembership[]> {
  assertResourceId(workspaceId, "workspace_id");
  assertResourceId(userId, "user_id");
  const query = new URLSearchParams({ workspaceId });
  const raw = asRecord(await requestJson(
    config,
    `${apiPath("admin", "users", userId, "projects")}?${query}`,
    "讀取使用者參與的專案",
  ));
  const list = raw?.memberships;
  if (!Array.isArray(list)) throw invalidResponse("讀取使用者參與的專案");
  const memberships = list.map(parseAdminUserProjectMembership);
  if (memberships.some((entry) => entry === null)) {
    throw invalidResponse("讀取使用者參與的專案");
  }
  return memberships as AdminUserProjectMembership[];
}
```

- [ ] **Step 5: 執行至通過**

```bash
pnpm exec tsx --test tests/project-api.test.ts
pnpm test
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add app/projects/types.ts app/projects/api.ts tests/project-api.test.ts
git commit -m "feat: add admin user project membership client API"
```

### Task 4: UI — 專案指派 modal

**Files:**
- Create: `app/components/projects/AdminUserProjectsModal.tsx`
- Modify: `app/components/projects/AdminUsersPanel.tsx`

**Interfaces:**
- Consumes: Task 3 的 `listAdminUserProjects`、`AdminUserProjectMembership`；既有
  `setProjectMember`、`removeProjectMember`、`listAdminProjects`。

新元件獨立成檔的理由：`AdminUsersPanel.tsx` 已 325 行且內含兩個 modal，再塞第三個會讓
單檔責任過雜。

- [ ] **Step 1: 確認 AdminProjectSummary 的實際欄位**

`grep -n "AdminProjectSummary" -A 12 app/projects/types.ts`。modal 需要「本 workspace 的
active 專案」清單：若該型別含 `workspaceId` 就同時以 workspaceId 與 `status === "active"`
過濾；若不含 workspaceId，則只能以 status 過濾——此時必須在報告中明確記錄這個限制
（多 workspace 環境下清單可能包含其他 workspace 的專案）。不要自行推測欄位存在。

**同時記下專案 id 與名稱的實際欄位名**：Step 3 的樂觀更新程式碼寫成
`projects.find((entry) => entry.id === projectId)?.name`，這是假設欄位為 `id`／`name`。
若該型別實際用 `projectId`／`projectName`（或其他命名），Step 3 與 Step 4 的存取一律
改用實際欄位名，不要照抄。

- [ ] **Step 2: 建立 modal 元件**

`app/components/projects/AdminUserProjectsModal.tsx`。結構沿用 `AdminUsersPanel.tsx`
既有 modal 的 class 慣例（`modalBackdrop`／`modal`／`modalHeader`／`modalEyebrow`／
`modalActions`）；角色選擇沿用 `ProjectMembersPanel.tsx` 的 `RoleSelect`（若它未被 export，
在本檔以相同選項與文案實作一份等價的 select：`owner` → `Project Owner`、
`member` → `Project Member`，且僅當目前值為 `viewer` 時額外顯示 disabled 的
「唯讀成員（舊版）」選項）。

Props：

```tsx
{
  config: SyncConfig;
  workspaceId: string;
  user: AdminUserSummary;
  onClose: () => void;
  onChanged: () => void;
}
```

載入邏輯（元件自行取兩份資料，讓 `AdminUsersPanel` 的改動維持最小）：

```tsx
  const [memberships, setMemberships] = useState<AdminUserProjectMembership[] | null>(null);
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
  const [error, setError] = useState("");
  const generations = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listAdminUserProjects(config, workspaceId, user.id),
      listAdminProjects(config),
    ])
      .then(([nextMemberships, nextProjects]) => {
        if (cancelled) return;
        setMemberships(nextMemberships);
        setProjects(nextProjects);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "讀取專案清單失敗，請稍後再試。");
      });
    return () => { cancelled = true; };
  }, [config, workspaceId, user.id]);
```

- [ ] **Step 3: 即時生效的儲存邏輯**

沿用 `ProjectMembersPanel.tsx` 剛建立的**樂觀更新＋逐項請求序號**模式（先讀該檔的
`saveAssignments` 與 `generations` 寫法再對接，保持一致）：

```tsx
  async function applyRole(projectId: string, next: ProjectRole | "") {
    if (!memberships) return;
    const previous = memberships;
    const generation = (generations.current[projectId] ?? 0) + 1;
    generations.current[projectId] = generation;
    const optimistic = next === ""
      ? previous.filter((entry) => entry.projectId !== projectId)
      : previous.some((entry) => entry.projectId === projectId)
        ? previous.map((entry) =>
            entry.projectId === projectId ? { ...entry, role: next } : entry)
        : [
            ...previous,
            {
              projectId,
              projectName: projects.find((entry) => entry.id === projectId)?.name ?? projectId,
              role: next,
              status: "active" as const,
            },
          ];
    setMemberships(optimistic);
    try {
      if (next === "") await removeProjectMember(config, projectId, user.id);
      else await setProjectMember(config, projectId, user.id, next);
      if (generations.current[projectId] !== generation) return;
      setError("");
      onChanged();
    } catch (cause: unknown) {
      if (generations.current[projectId] !== generation) return;
      setMemberships(previous);
      setError(membershipErrorMessage(cause));
    }
  }
```

`membershipErrorMessage` 在本檔實作，`last_owner` 必須有專屬文案：

```tsx
function membershipErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError && cause.code === "last_owner") {
    return "此專案至少需要一位 owner，請先指派其他 owner。";
  }
  return cause instanceof Error ? cause.message : "更新專案成員失敗，請稍後再試。";
}
```

（`ApiClientError` 與其 `code` 欄位來自 `app/projects/api.ts`；先確認 export 名稱。）

- [ ] **Step 4: 渲染**

- 標題：`modalEyebrow` 為「使用者管理」，`h2` 為 `${user.displayName} 的專案`。
- `memberships` 為 null 時顯示「讀取中…」。
- **active 專案列表**（依 Step 1 的過濾結果）：每列專案名稱 ＋ 角色 select。select 的值
  為該使用者在該專案的角色，未參與時為空字串並顯示「未參與」選項；選擇角色即加入，
  選回「未參與」即移除。
- **archived 專案的既有 membership**：另一區塊唯讀列出，每列標示「已封存」，不提供
  select 與移除。
- `error` 以既有 `notice readOnlyNotice` 樣式呈現（沿用 `role="alert"`）。
- 底部 `modalActions` 放「關閉」按鈕（`secondaryButton`）——本 modal 無表單提交。
- 空狀態：無 active 專案時顯示「目前沒有使用中的專案可指派。」

- [ ] **Step 5: 接進 AdminUsersPanel**

- 新增 state：`const [assigning, setAssigning] = useState<AdminUserSummary | null>(null);`
- 使用者列的「管理」按鈕旁加一顆：

```tsx
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setAssigning(user)}
              >
                專案
              </button>
```

- 在既有 `{editing && (...)}` 附近渲染：

```tsx
      {assigning && (
        <AdminUserProjectsModal
          config={config}
          workspaceId={workspaceId}
          user={assigning}
          onClose={() => setAssigning(null)}
          onChanged={() => setRefreshToken((token) => token + 1)}
        />
      )}
```

`onChanged` 遞增既有的 `refreshToken` 會重抓 `/admin/users`，使「參與專案」件數更新。

- [ ] **Step 6: 驗證**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

全綠。UI 元件在本專案無測試 harness，行為由 Task 5 的人工驗收清單覆蓋。

- [ ] **Step 7: Commit**

```bash
git add app/components/projects/AdminUserProjectsModal.tsx app/components/projects/AdminUsersPanel.tsx
git commit -m "feat: assign project memberships from user management"
```

### Task 5: 文件與完整品質關卡

**Files:**
- Modify: `README.md`
- Modify: `NextTasks.md`

- [ ] **Step 1: README 記錄已知限制**

在「Project／Board 與同步行為」清單末尾加入（規格 §2.2 要求，讓後續維護者知道這是刻意
選擇而非疏漏）：

```markdown
- workspace owner／admin 可從平台管理的使用者管理指派任何專案的成員，包含把自己加入
  專案——這會取得該專案的工作內容讀取權，是刻意接受的權限升級路徑，以 Activity Log
  的 `via: "platform_admin"` 稽核而非技術阻擋。
```

- [ ] **Step 2: NextTasks 狀態與驗收**

- 「目前真實狀態」表新增一列：

```markdown
| 平台管理指派專案成員 v1 | 已實作，待 staging 部署與驗收 | workspace owner／admin 可從使用者管理指派任何專案的成員與角色；放寬只作用於 `PUT`／`DELETE /projects/:projectId/members/:userId`，其餘 manage 操作不變；新增 admin-only `GET /admin/users/:userId/projects`；專案外 admin 的變更在 Activity Log 標 `via: "platform_admin"` |
```

- P0-4 驗收清單新增（沿用既有 `- [ ]` 格式）：

```markdown
- [ ] workspace admin 可從使用者管理把使用者加入專案、改角色、移除。
- [ ] admin 自我指派成功，且 Activity Log 可辨識（actor 與 target 相同）。
- [ ] 專案外 admin 的 membership 變更在 Activity Log 標 `via: "platform_admin"`；本身是專案 owner 時不標。
- [ ] 移除最後一位 owner 顯示「此專案至少需要一位 owner，請先指派其他 owner。」而非泛用訊息。
- [ ] archived 專案的既有 membership 唯讀顯示；active 專案可指派。
- [ ] 變更後使用者列的「參與專案」件數更新。
- [ ] 放寬未外溢：未加入專案的 admin 對該專案的看板內容、附件與 Log 存取行為不變。
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
git commit -m "docs: record admin project membership assignment"
```

## 部署備註（執行者不自行執行）

本功能無 D1 migration。部署由使用者決定時機：

1. `pnpm sync:deploy:staging`
2. `pnpm web:deploy:beta`

production 不在本次範圍（見 NextTasks P0-5）。
