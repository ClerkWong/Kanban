# 多專案／多看板管理 v1 — 實作計畫

- 日期：2026-07-24
- 狀態：Ready for implementation
- 對應規格：
  [`2026-07-24-multi-project-multi-board-design.md`](../specs/2026-07-24-multi-project-multi-board-design.md)
- 目前 production：既有單一看板 3a
- 目前 Web：private beta v1，固定於 `bd17e5b`

## Goal

把目前單一共用 Board 升級為：

```text
Workspace → Project → Board → Card
```

每位使用者以個人 token 識別，在不同 Project 擁有獨立角色；只看見參與的 Project。
Project 可有多個名稱獨立的 Board，Project 內提供總覽、封存與 Activity Log。既有
BoardState、附件、月報與離線合併能力要保留，production 單一看板須可無損遷移。

## Architecture

- D1 成為 identity、Workspace、Project、membership、Board metadata/content 與 Log
  的權威來源。
- `BoardState` 仍是單一 Board 的 JSON 文件；revision 改為每個 Board 獨立。
- R2 維持每個環境一個 private bucket，但 object key 加入 Workspace/Project/Board。
- Web 與 Capacitor 使用同一個 `ProjectApp`，以 hash navigation 避免新增 router
  dependency 並維持離線／靜態 bundle 相容。
- Administrative mutations 需要在線；Board content 維持離線優先。
- `/board` 在一個相容週期內映射到新版 legacy Board row，不維護第二份資料。

## Dependency graph

```text
Task 1 Domain types ──→ Task 2 Local storage/migration ───────────┐
                                                                 │
Task 3 D1 schema ─→ Task 4 Auth/authz ─→ Task 5 Project APIs ─┐  │
                                                             ├──┼→ Task 9 Client APIs
                                Task 6 Board APIs/alias ───────┤  │
                                Task 7 Summary/ActivityLog ────┤  │
                                Task 8 Scoped attachments ─────┘  │
                                                                 ↓
Task 9 ─→ Task 10 Per-board sync ─→ Task 11 Navigation ─→ Task 12 Management UI
                                                        └──────→ Task 13 Migration/E2E
                                                                    ↓
                                                              Task 14 Staging handoff
```

Task 1–2 與 Task 3–8 可由不同工作流平行進行，但 Task 9 之後必須使用同一份已核准 API
contract。不要在尚未整合時建立 staging。

## Global constraints

- 不變更或部署 production，直到 staging 全部驗收通過。
- 現有 private beta 維持可回退版本；半成品不可覆蓋 beta。
- 不建立 staging D1/R2/Worker，直到 Task 1–13 完成。
- 每個 Task 使用單一、可審查、可回退的 commit。
- TypeScript strict；不可引入 `any` 或信任未驗證 JSON。
- 優先使用既有依賴；若確實需要新 dependency，必須獨立說明與審查。
- 所有使用者可見文案使用繁體中文。
- Worker 每個 request 都由 server 查出 user、membership 與 role；client 傳入的
  actor/role 沒有效力。
- Bearer token、token hash、Authorization header 與附件內容不得出現在 repo、
  log、測試 snapshot 或 bundle。
- D1 migration 採 additive／可回退設計；禁止在同一 migration 直接刪除 legacy 資料。
- Project/Board archive 不刪 D1 或 R2。
- 每個 Board 的 revision、cache、debounce 與 queue 必須隔離。
- 每個 Task 至少執行該節列出的測試；里程碑另外跑完整品質關卡。

## Shared API and model decisions

實作者開始前先固定以下名稱，避免前後端各自發明：

```ts
type WorkspaceRole = "owner" | "admin" | "member";
type ProjectRole = "manager" | "contributor" | "viewer";
type ResourceStatus = "active" | "archived";

type BoardContext = {
  workspaceId: string;
  projectId: string;
  boardId: string;
};
```

Client administrative API base:

```text
/me
/projects
/projects/:projectId/members
/projects/:projectId/boards
/projects/:projectId/boards/:boardId/content
/projects/:projectId/logs
```

R2 key：

```text
workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/attachments/{attachmentId}
```

---

## Task 1：建立 Project domain、角色能力與安全 parser

**Files**

- Create: `app/projects/types.ts`
- Create: `app/projects/model.ts`
- Create: `tests/project-model.test.ts`

**Produces**

- `WorkspaceRole`、`ProjectRole`、`Project`、`ProjectMembership`、`BoardMeta`、
  `ProjectSummary`、`ActivityLogEntry`、`BoardContext`。
- `parseProject()`、`parseBoardMeta()`、`parseProjectList()`。
- `normalizeResourceName()`：trim、1–80 字元、產生 case-folded comparison key。
- `canManageProject()`、`canEditBoard()`、`canReadProject()` 等純函式。
- UUID 與 local placeholder ID 的明確驗證函式。

**Steps**

- [x] 先寫角色矩陣、空白／過長名稱、malformed JSON 與 ID validation 的失敗測試。
- [x] 實作 domain types 與 parser，不修改目前 `BoardState`。
- [x] 明確區分 `ProjectMembership` 與既有 `Card.members`；後者仍是顯示文字且不參與 ACL。
- [x] 確保 viewer 永遠無 mutation capability；contributor 無 membership/archive 能力。
- [x] 確保 workspace role 不會自動轉換成 Project content permission。
- [x] 執行：

  ```bash
  pnpm test
  pnpm lint
  pnpm typecheck
  ```

**Commit**

```text
Add multi-project domain types
```

---

## Task 2：建立 per-board 本機 storage 與 legacy migration

**Depends on:** Task 1

**Files**

- Create: `app/projects/storage.ts`
- Create: `app/projects/migrate-legacy.ts`
- Create: `tests/project-storage.test.ts`
- Create: `tests/project-migration.test.ts`
- Modify: `app/board-model.ts`（只匯出 legacy key／必要 helper，不混入 Project metadata）

**Storage keys**

```text
kanban-workspace-index-v1
kanban-active-context-v1
kanban-board-v1:{boardId}
kanban-sync-revision-v2:{boardId}
kanban-attachment-queue-v2
kanban-sync-config-v2
```

**Steps**

- [x] 定義可注入的 `StorageLike`，測試不直接依賴 browser global。
- [x] 寫入 project index、active context 與 per-board BoardState parser。
- [x] 使用 `local:legacy-project`／`local:legacy-board` 作為只存在本機的 placeholder；
  placeholder 絕不可送入 API。
- [x] 偵測舊 `kanban-pwa-board-v1`，複製到新版 key 並驗證 serialize round trip。
- [x] 遷移成功前保留舊 key；不可先刪再寫。
- [x] 重複執行 migration 必須冪等，不重複 Project/Board；中斷後可重跑修復。
- [x] malformed 舊資料使用既有安全 fallback，並保留可理解的 migration error。
- [x] 加入 active Board 切換測試，確認 Board A/B 不共用內容或 revision。
- [x] 執行：

  ```bash
  pnpm test
  pnpm lint
  pnpm typecheck
  pnpm build
  pnpm mobile:build
  ```

**Commit**

```text
Add multi-board local storage migration
```

---

## Task 3：新增 D1 multi-project schema 與本機 bootstrap

**Files**

- Create: `worker-sync/migrations/0002_multi_project.sql`
- Create: `worker-sync/src/db-types.ts`
- Create: `scripts/bootstrap-sync-workspace.ts`
- Create: `tests/bootstrap-workspace.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Schema**

- `workspaces`
- `workspace_members`
- `user_accounts`（v2 User；legacy `users` 保持原狀）
- `access_tokens`
- `projects`
- `project_members`
- `boards`
- `activity_logs`
- `migration_state`

**Migration requirements**

- [x] 保留原 `board` row 與 `users`，migration 過程不得 rename/drop。
- [x] additive migration 不立即複製 legacy Board，避免 migration/deploy 空窗漏寫。
- [x] 建立 deterministic default Workspace ID。
- [x] `user_accounts` 與 `access_tokens` 可從 legacy users 準備過渡資料，但原 rows 保留。
- [x] legacy token 標記為 legacy；不嘗試推測實際 actor。
- [x] 建立 `migration_state`，初始為 `pending`；v2 Project API 在完成前不可啟用。
- [x] fresh DB 沒有 legacy Board 時，bootstrap 建立 Workspace owner 後可直接標記完成。
- [x] 建立 active normalized name unique indexes、membership 與 log pagination indexes。
- [x] migration 重跑由 D1 migration table 阻止，SQL 本身避免留下半成品。

**Bootstrap script**

- 從 TTY/stdin 安全讀取 token，不接受命令列 token。
- 建立／更新 workspace owner、個人 access token 與 legacy Project manager mapping。
- 支援 local、staging、production 明確 target；production 必須額外確認。
- stdout 不回顯 token，只顯示 user/project IDs 與完成狀態。

**Validation**

```bash
pnpm test
pnpm worker:test
pnpm typecheck
```

以本機 D1 套用 0001 → 0002，驗證空資料庫與含 legacy board 兩條路徑。

**Commit**

```text
Add multi-project D1 schema
```

---

## Task 4：拆分 Worker HTTP、identity、authorization 與 audit foundation

**Depends on:** Task 3

**Files**

- Create: `worker-sync/src/http.ts`
- Create: `worker-sync/src/auth.ts`
- Create: `worker-sync/src/authorization.ts`
- Create: `worker-sync/src/audit.ts`
- Create: `worker-sync/src/router.ts`
- Modify: `worker-sync/src/index.ts`
- Create: `worker-sync/test/auth.integration.test.ts`
- Modify: `worker-sync/test/worker.integration.test.ts`

**Steps**

- [x] 將 CORS、JSON response、request ID 與 error logging 從 `index.ts` 抽離。
- [x] `authenticate()` 回傳 `AuthenticatedUser`，不再只回 boolean。
- [x] token lookup 只接受 active user、未撤銷 token。
- [x] 以非阻塞方式更新 `last_used_at`，失敗不得洩漏 token 或使合法 request 500。
- [x] 建立 Workspace/Project membership lookup 與 capability checks。
- [x] 建立 append-only `writeAuditEvent()`；client 不可傳 actor。
- [x] router 僅負責 method/path dispatch；route handler 必須宣告所需 capability。
- [x] 保留既有 `/board` 與附件測試全綠，避免重構時改變 3a 行為。

**Tests**

- 401：missing、incorrect、revoked、disabled user。
- 個人 token 對應正確 user。
- workspace admin 未加入 Project 時無 content access。
- 404：無 membership；403：有 membership 但角色不足。
- request/log 不含 Authorization 值。

```bash
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm sync:dry-run
pnpm sync:dry-run:staging
```

**Commit**

```text
Add Worker identity and authorization
```

---

## Task 5：實作 Project 與 membership API

**Depends on:** Task 4

**Files**

- Create: `worker-sync/src/projects.ts`
- Create: `worker-sync/src/memberships.ts`
- Create: `worker-sync/src/validation.ts`
- Create: `worker-sync/test/projects.integration.test.ts`（同檔涵蓋 Project 與 membership）
- Modify: `worker-sync/src/router.ts`

**Endpoints**

```text
GET    /me
GET    /projects
POST   /projects
GET    /projects/:projectId
PATCH  /projects/:projectId
POST   /projects/:projectId/archive
POST   /projects/:projectId/restore
GET    /projects/:projectId/members
PUT    /projects/:projectId/members/:userId
DELETE /projects/:projectId/members/:userId
```

**Steps**

- [x] `GET /projects` 只查詢 caller memberships。
- [x] admin-only registry 使用 `/admin/projects`，只回管理 metadata。
- [x] Project create 使用 client-generated UUID 作 idempotency key；建立者成為 manager。
- [x] 驗證 active normalized name uniqueness；衝突回 409。
- [x] PATCH 只接受白名單欄位，不允許改 workspace ID、creator 或 status。
- [x] 不可移除／降級最後一位 active manager。
- [x] Project archive/restore 需 manager；restore 名稱衝突回 409。
- [x] 每個成功 mutation 與 membership change 原子寫入 audit。
- [x] archived Project membership 可調整，但內容仍唯讀；所有變更需留 Log。

**Tests**

- 三種 Project role 的 permission matrix。
- User A 無法列出或猜測 User B Project。
- 同一 user 在兩個 Project 有不同角色。
- 最後 manager guard。
- create/rename/archive/restore idempotency 與 conflict。

```bash
pnpm worker:test
pnpm lint
pnpm typecheck
```

驗收結果（2026-07-26）：112 個單元測試、21 個 Worker runtime tests、lint、
typecheck、typed `no-floating-promises` 與 production/staging Worker dry-run 全數通過；
runtime test 已確認 audit 寫入失敗時 mutation 會回滾。

**Commit**

```text
Add project membership APIs
```

---

## Task 6：實作 multi-board content API 與 legacy `/board` alias

**Depends on:** Task 5

**Files**

- Create: `worker-sync/src/boards.ts`
- Create: `worker-sync/test/boards.integration.test.ts`
- Create: `worker-sync/test/legacy-board.integration.test.ts`
- Modify: `worker-sync/src/router.ts`
- Modify: `worker-sync/src/logic.ts`
- Modify: `worker-sync/test/worker.integration.test.ts`

**Endpoints**

```text
GET    /projects/:projectId/boards
POST   /projects/:projectId/boards
GET    /projects/:projectId/boards/:boardId
PATCH  /projects/:projectId/boards/:boardId
PUT    /projects/:projectId/boards/:boardId/content
POST   /projects/:projectId/boards/:boardId/archive
POST   /projects/:projectId/boards/:boardId/restore
GET    /board
PUT    /board
```

**Steps**

- [x] Board metadata/name 和 `BoardState` JSON 分開。
- [x] Board create 使用 client UUID；name 在 active Project 內 normalized unique。
- [x] content GET/PUT 使用 per-board revision 與既有 1 MiB limit。
- [x] 409 只回目前 Board 的 revision/data，不混入其他 Board。
- [x] manager/contributor 可 PUT content；viewer 只能 GET。
- [x] archived Project 或 archived Board 的 content mutation 回 `resource_archived`，GET 保持
  可用；archived Board 可先改名以解決 restore name conflict。
- [x] Board archive/restore 不刪 data、revision 或 R2。
- [x] `/board` alias 直接解析 caller 可存取的 legacy Board ID，使用同一 row 與 revision。
- [x] migration `pending` 時 alias 使用 legacy `board`；`locked` 時 PUT 回 retryable 503；
  `complete` 時改用新版 `boards`。
- [x] alias 不建立長期 dual-write 或同時更新兩份 JSON。
- [x] 每個成功 content PUT 和 lifecycle mutation 寫入 audit foundation。

**Tests**

- Board A/B revision 完全獨立。
- 跨 Project board ID 猜測回 404。
- active name conflict、archive/read-only、restore。
- 兩個 concurrent `baseRevision=0` 仍收斂為 409。
- legacy/new endpoint 讀寫同一 row。

```bash
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm sync:dry-run
```

驗收結果（2026-07-27）：113 個單元測試、33 個 Worker runtime tests、lint、
typecheck、typed `no-floating-promises` 與 production/staging Worker dry-run 全數通過；
runtime tests 已確認 concurrent revision conflict、跨 Project 隔離、audit failure rollback，
以及 migration 三狀態下 `/board` 不會 dual-write。

**Commit**

```text
Add multi-board content APIs
```

---

## Task 7：實作 Project summary、server diff 與 Activity Log

**Depends on:** Task 6

**Files**

- Create: `worker-sync/src/board-diff.ts`
- Create: `worker-sync/src/reports.ts`
- Create: `worker-sync/src/logs.ts`
- Create: `tests/board-diff.test.ts`
- Create: `worker-sync/test/reports.integration.test.ts`
- Create: `worker-sync/test/logs.integration.test.ts`
- Modify: `worker-sync/src/boards.ts`
- Modify: `worker-sync/src/router.ts`

**Endpoints**

```text
GET /projects/:projectId/summary
GET /projects/:projectId/logs
GET /projects/:projectId/boards/:boardId/logs
```

**Steps**

- [x] Worker 比較成功 PUT 前後的 canonical BoardState。
- [x] 每個成功 Board revision 寫一筆 `board.content_updated`，其中產生 card created、
  changed fields、moved、completed、reopened、deleted changes。
- [x] attachment 只記 add/remove metadata，不記 bytes；Card description 不記完整前後值。
- [x] `metadata.changes` 最多 200 筆；超過時寫各類 count 與 `truncated: true`。
- [x] Project summary 預設只計 active Board，可明確包含 archived。
- [x] 月報使用 `completedAt`，最近六個日曆月含零資料月份。
- [x] Log cursor pagination 預設 50、上限 200，排序穩定。
- [x] viewer 可讀 summary/log；無 membership 仍回 404。
- [x] audit 寫入失敗時 Board mutation 不得成功。

**Tests**

- 離線批次只產生 final before/after diff。
- Project summary 不混入其他 Project。
- archived Board 預設排除，include flag 正確。
- Log 不含 token、description 全文或附件內容。
- 同 timestamp 以 ID 作穩定 cursor。

```bash
pnpm test
pnpm worker:test
pnpm lint
pnpm typecheck
```

驗收結果（2026-07-27）：115 個單元測試、40 個 Worker runtime tests、lint 與
typecheck 全數通過；runtime tests 已確認 Project／Board Log 隔離、同 timestamp
cursor 穩定分頁、archived history 可讀、summary 預設排除 archived Board、六個月零值，
以及 Log 不含 description 全文、附件內容或 Bearer token。Task 6 的 audit failure
rollback 測試亦持續通過。

**Commit**

```text
Add project summaries and activity logs
```

---

## Task 8：將 Attachment API 與 R2 key 限定到 Board

**Depends on:** Task 6

**Files**

- Create: `worker-sync/src/attachments.ts`
- Create: `worker-sync/test/attachments-scoped.integration.test.ts`
- Modify: `worker-sync/src/index.ts`
- Modify: `worker-sync/src/router.ts`
- Modify: `worker-sync/test/worker.integration.test.ts`

**Endpoints**

```text
PUT    /projects/:projectId/boards/:boardId/attachments/:attachmentId
GET    /projects/:projectId/boards/:boardId/attachments/:attachmentId
DELETE /projects/:projectId/boards/:boardId/attachments/:attachmentId
```

**Steps**

- [x] Worker 從已授權 context 組合 R2 key，不接受完整 key。
- [x] manager/contributor 可 PUT/DELETE；viewer 僅 GET。
- [x] archived Project/Board 仍可 GET，拒絕 PUT/DELETE。
- [x] 保留 10 MiB bounded stream、MIME allowlist、ETag、nosniff 與 request ID。
- [x] 同 attachment ID 在不同 Board 形成不同 R2 objects。
- [x] 無 membership 或 Board 不屬於 Project 時，在碰 R2 前回 404。
- [x] production R2 尚無舊資料，因此不新增舊 `/attachments/:fileName` alias。
- [x] 更新 CORS methods/headers 測試但不放寬認證。

**Tests**

- 三角色 permission。
- cross-project/cross-board isolation。
- archive read-only。
- 10 MiB、empty、invalid ID、unsupported MIME、404。
- D1 authz failure 不執行 R2 operation。

```bash
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm sync:dry-run
pnpm sync:dry-run:staging
```

驗收結果（2026-07-27）：115 個單元測試、46 個 Worker runtime tests、lint、
typecheck、generated Worker types check 與 production/staging Worker dry-run 全數通過；
runtime tests 已確認三角色權限、跨 Project／Board 隔離、archived read-only、10 MiB
精確邊界、empty／invalid ID／unsupported MIME／404，以及 D1 authz failure 不會碰 R2。
既有 `AttachmentRef.id` 為 `att-…`，因此 scoped endpoint 接受 1–128 字元的安全單一
ID segment；仍拒絕 fileName、斜線與完整 R2 key。

**Commit**

```text
Scope attachments to project boards
```

---

## Task 9：建立 client session、Project API 與 Board API v2

**Depends on:** Task 1、Task 5、Task 6、Task 7、Task 8

**Files**

- Create: `app/projects/api.ts`
- Create: `app/projects/session.ts`
- Create: `app/projects/repository.ts`
- Create: `tests/project-api.test.ts`
- Create: `tests/project-session.test.ts`
- Modify: `app/sync/config.ts`
- Modify: `app/sync/api.ts`
- Modify: `app/sync/attachment-api.ts`
- Modify: `app/components/board/SyncSettingsModal.tsx`

**Steps**

- [x] `SyncConfig` v2 仍只持久化 base URL/token；`/me` 回應建立 runtime session。
- [x] 個人 user ID、workspace role 不接受 local override。
- [x] 實作 Project list/detail/summary/members/logs client。
- [x] 實作 Board list/metadata/content/archive/restore client。
- [x] Board fetch/push 都要求 `BoardContext`。
- [x] Attachment URL 使用 Project/Board/Attachment IDs，不再只用 fileName。
- [x] 統一 401/403/404/409/resource_archived error mapping。
- [x] token 切換時清除 runtime session 與 remote index，不刪本機 Board data。
- [x] Sync settings 首次連線先呼叫 `/me`，顯示目前 user display name。

**Tests**

- URL encoding 與 nested resource path。
- token/user 切換不重用舊 session。
- 403、404、revision 409、archived 409 mapping。
- response parser 拒絕 malformed Project/Board data。

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
```

驗收結果（2026-07-27）：124 個單元測試、46 個 Worker runtime tests、lint、
typecheck、Web build 與 mobile build 全數通過。Client parser 已拒絕 malformed
Project、Board、summary、revision 與 session payload；測試亦涵蓋 nested URL encoding、
401/403/404/409/`resource_archived` mapping、token 切換與逾時 session 回應隔離。
Task 10 完成前，既有單一看板 UI 明確使用 `legacy` compatibility functions；新的 v2
Board 與 Attachment API 一律要求 `BoardContext`，不會讓尚未具備 Project 導航的 UI
猜測遠端資源。

**Commit**

```text
Add multi-project client APIs
```

---

## Task 10：重構 per-board sync、revision 與 Attachment queue v2

**Depends on:** Task 2、Task 9

**Files**

- Create: `app/sync/useBoardSync.ts`
- Create: `app/projects/useBoardStore.ts`
- Modify: `app/sync/useSync.ts`（完成後移除或改成薄 compatibility wrapper）
- Modify: `app/sync/config.ts`
- Modify: `app/sync/attachment-queue.ts`
- Modify: `app/sync/attachment-api.ts`
- Create: `tests/board-sync-context.test.ts`
- Modify: `tests/attachment-queue.test.ts`
- Modify: `tests/attachment-api.test.ts`
- Modify: `tests/sync-config.test.ts`

**Steps**

- [ ] `useBoardStore(boardId)` 只讀寫該 Board local key。
- [ ] `useBoardSync(context, board, setBoard, loaded)` 管理 per-board revision/debounce。
- [ ] 切換 Board 時取消舊 request 的寫回；晚到 response 不得污染新 Board。
- [ ] queue v2 item 包含 endpoint identity、userId、workspaceId、projectId、boardId、
  attachmentId、fileName、operation。
- [ ] queue v1 無法判定 Board 時停住並顯示 migration blocker，不猜測 destination。
- [ ] pending upload 仍先成功，再允許相同 Board content 發布 ref。
- [ ] remote archive/membership removal 保留 local pending data，停止自動重試。
- [ ] Board A/B 可同時有 pending queue，不互相阻塞或去重。
- [ ] 移除全域單一 revision key 的實際使用，保留一次性 migration read。

**Tests**

- Board A/B concurrent sync。
- 切換 Board 時 stale response suppression。
- user/token/endpoint/project/board isolation。
- archive、403/404 與 retry policy。
- queue v1 migration blocker。

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
```

**Commit**

```text
Isolate sync state by board
```

---

## Task 11：建立 ProjectApp、我的專案與 Board navigation

**Depends on:** Task 2、Task 9、Task 10

**Files**

- Create: `app/components/projects/ProjectApp.tsx`
- Create: `app/components/projects/MyProjectsView.tsx`
- Create: `app/components/projects/ProjectOverview.tsx`
- Create: `app/components/projects/BoardNavigation.tsx`
- Create: `app/projects/navigation.ts`
- Create: `tests/project-navigation.test.ts`
- Modify: `app/components/board/BoardApp.tsx`
- Modify: `app/page.tsx`
- Modify: `mobile/main.tsx`
- Modify: `app/globals.css`

**Navigation**

```text
#/projects
#/projects/:projectId
#/projects/:projectId/boards/:boardId
```

**Steps**

- [ ] Web/Capacitor 都掛載 `ProjectApp`，不複製 UI。
- [ ] 未設定同步時保留 local legacy Board 入口與啟用同步流程。
- [ ] 有 session 時預設顯示「我的專案」，只使用 API 已授權資料。
- [ ] Project overview 顯示 Project summary、active Board list、自己的角色。
- [ ] Board 頁面顯示 breadcrumb、Board switcher 與 archive banner。
- [ ] `BoardApp` 接受 `BoardContext`、permissions 與 store/sync handle，不再假設唯一 Board。
- [ ] viewer/archived 隱藏或停用新增、編輯、拖放、WIP、附件 mutation。
- [ ] hash 解析拒絕 malformed IDs，fallback 到最近有效 context 或我的專案。
- [ ] 鍵盤 focus、mobile safe-area 與水平看板體驗不回歸。

**Tests**

- hash parse/serialize round trip。
- 無權 context fallback。
- role-to-visible-actions view model 純函式。
- Web/mobile build。

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
```

**Commit**

```text
Add project and board navigation
```

---

## Task 12：加入 Project management、封存、成員與 Log UI

**Depends on:** Task 11

**Files**

- Create: `app/components/projects/ProjectSettingsModal.tsx`
- Create: `app/components/projects/ProjectMembersPanel.tsx`
- Create: `app/components/projects/ArchivedBoardsPanel.tsx`
- Create: `app/components/projects/ActivityLogPanel.tsx`
- Create: `app/components/projects/CreateBoardModal.tsx`
- Create: `app/projects/view-model.ts`
- Create: `tests/project-view-model.test.ts`
- Modify: `app/components/projects/ProjectOverview.tsx`
- Modify: `app/globals.css`

**Steps**

- [ ] manager 可建立／改名／封存／還原 Board。
- [ ] manager 可改 Project 名稱、管理 member role、封存／還原 Project。
- [ ] 不顯示永久刪除。
- [ ] 最後 manager guard 在 UI 預先提示，但仍以 server 為準。
- [ ] contributor/viewer 不顯示管理入口；直接呼叫 API 仍由 Worker 拒絕。
- [ ] archived Project/Board 使用唯讀版面並保留 summary/log/attachment download。
- [ ] Log 支援 Project/Board filter、cursor 載入更多與可理解的繁中 action 文案。
- [ ] Project summary 預設排除 archived Board，提供明確「包含封存」filter。
- [ ] 管理 mutation 斷網時立即說明需要連線，不排入 Board offline queue。

**Validation**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
pnpm mobile:sync
```

手動檢查 360 px、768 px、桌面寬度及鍵盤操作。

**Commit**

```text
Add project management views
```

---

## Task 13：完成 legacy migration、個人 token 切換與端到端測試

**Depends on:** Task 3–12

**Files**

- Modify: `app/projects/migrate-legacy.ts`
- Create: `app/components/projects/LegacyMigrationModal.tsx`
- Create: `scripts/verify-multi-project-migration.ts`
- Create: `tests/legacy-client-migration.test.ts`
- Create: `worker-sync/test/multi-project-e2e.integration.test.ts`
- Modify: `README.md`
- Modify: `NextTasks.md`

**Steps**

- [ ] 偵測 local placeholder 與 server legacy Project/Board，提供 merge/remote 選擇。
- [ ] migration command 先把 `migration_state` 設為 `locked`，阻擋 legacy PUT。
- [ ] lock 後才讀取最新 legacy row，建立 Workspace/Project/Board 與 memberships。
- [ ] Board copy、role/token mapping 全數成功後才原子標記 `complete`；失敗回 `pending`。
- [ ] merge 使用既有 card-level LWW 與 tombstones，不做整份覆蓋。
- [ ] migration 完成並成功 serialize/sync 後才標記完成；保留一次可匯出的 legacy backup。
- [ ] shared legacy token 顯示換發提示；個人 token 驗證成功後才撤銷舊 token。
- [ ] 驗證 old `/board` client 與 v2 client 使用同一 revision row。
- [ ] migration lock 期間 old client 保留 pending data並在解除後重試。
- [ ] 驗證 attachment queue v1 不會送到錯誤 Board。
- [ ] 建立 migration verification script，比對 card/count/revision/completedAt/attachments/
  tombstones，不輸出 Card descriptions 或 token。
- [ ] README 補上 Workspace/Project/Board 操作、角色與 migration runbook。

**E2E scenarios**

- legacy single Board → default Project/Board。
- User A manager、User B contributor、User C viewer、User D 無 membership。
- 同 Project 兩個 Board 雙裝置衝突與附件隔離。
- Board archive while device offline with pending changes。
- Project summary 與 Log after merge。

```bash
pnpm test
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
pnpm worker:types:check
pnpm sync:dry-run
pnpm sync:dry-run:staging
git diff --check
```

**Commit**

```text
Migrate legacy boards to projects
```

---

## Task 14：建立 staging-ready release candidate

**Depends on:** Task 13

**Files**

- Modify: `.github/workflows/ci.yml`
- Modify: `NextTasks.md`
- Create: `docs/runbooks/multi-project-staging.md`
- Create: `docs/runbooks/token-lifecycle.md`

**Steps**

- [ ] CI 增加 multi-project migration、role matrix 與 legacy alias tests。
- [ ] 重新產生並檢查 Worker bindings types。
- [ ] fresh clone 執行完整品質關卡。
- [ ] Android debug 與未簽章 iOS simulator build。
- [ ] final `pnpm mobile:sync`，確認原生 bundle 是同一 commit。
- [ ] 撰寫 staging bootstrap：workspace owner、個人 tokens、Project roles。
- [ ] 撰寫 token create/revoke/rotate/device-lost 流程。
- [ ] 撰寫 staging reset：D1 board/log 與 R2 object 協調清除。
- [ ] 更新 `NextTasks.md`，將本機實作標記完成，但 staging 驗收仍保持未勾選。
- [ ] commit 後才依 `NextTasks.md` 建立 staging 遠端資源。

**Full gate**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm worker:test
pnpm lint
pnpm typecheck
pnpm build
pnpm mobile:build
pnpm worker:types:check
pnpm sync:dry-run
pnpm sync:dry-run:staging
pnpm mobile:sync
git diff --check
```

**Commit**

```text
Prepare multi-project staging release
```

## Milestone gates

### Milestone A — Domain ready

Task 1–2 已於 2026-07-26 完成：

- local multi-board storage 可用。
- legacy local migration 冪等且不刪原資料。
- 尚未切換 UI。

### Milestone B — Worker API v2 ready

Task 3–8 完成：

- identity、ACL、Project/Board/Attachment API、summary、Log 全部 runtime-tested。
- legacy `/board` 行為未退化。
- 尚未建立遠端資源。

### Milestone C — Client integrated

Task 9–12 完成：

- Web/App 可瀏覽我的專案、Project overview、多 Board。
- per-board sync/queue 隔離。
- roles、archive、Log UI 完成。

### Milestone D — Staging-ready

Task 13–14 完成：

- legacy migration、個人 token、E2E、CI、原生 build 與 runbook 完成。
- 可以依 `NextTasks.md` 建立 staging。

## Stop conditions during implementation

出現以下情況就停止合併後續 Task，先修正：

- legacy Board migration 會重置 revision 或遺失 Card、completedAt、attachments、墓碑。
- workspace admin 可在沒有 Project membership 時讀到 content。
- 不同 Project/Board 共用 revision、local key、queue item 或 R2 key。
- archived resource 仍可 mutation。
- audit 寫入失敗但 mutation 回成功。
- shared token 無法安全換發為個人 token。
- `/board` alias 和 v2 Board row 發生 dual-write 或資料分叉。
- repo、log、snapshot、bundle 出現 token 或附件內容。
- 現有 beta／production 被半成品覆蓋。

## Estimated effort

| 工作流 | 估計 |
| --- | --- |
| Domain、local storage、migration | 1–1.5 天 |
| D1、identity、ACL、Project/Board APIs | 1.5–2.5 天 |
| Summary、ActivityLog、scoped attachments | 1–1.5 天 |
| Client API、per-board sync、queue | 1–1.5 天 |
| Project/Board UI 與 role/archive/log | 1.5–2 天 |
| Legacy E2E、CI、文件與 staging handoff | 1–1.5 天 |
| 合計 | 約 7–10 個專注開發日 |

staging 雙裝置與實機驗收另計 2–3 天；production cutover 另計 1 天。
