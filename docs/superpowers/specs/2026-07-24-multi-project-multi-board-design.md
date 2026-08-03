# 多專案／多看板管理 v1 — 設計規格

- 日期：2026-07-24
- 狀態：已由使用者核准
- 取代範圍：既有「全團隊共用單一看板」的資料、認證與同步模型
- 不取代：既有卡片、附件、月報、離線合併、Web/PWA 與 Capacitor 平台能力

> 2026-08-03 補充：角色名稱與「每個 Project 一個使用中 Board」已由
> [`2026-08-03-project-admin-owner-member-design.md`](./2026-08-03-project-admin-owner-member-design.md)
> 取代。本文件其餘隔離、封存與同步設計繼續有效。

## 1. 背景

目前系統只有一份共用 `BoardState`：

- 本機使用單一 `kanban-pwa-board-v1`。
- D1 使用固定 `board.id = 1`。
- Worker 只有 `/board` 與全域 `/attachments/:fileName`。
- Bearer token 只判斷是否有效，沒有專案成員或角色授權。
- revision、附件 queue、月報與刪除墓碑都只服務一個看板。

新需求是以多個專案管理不同開發工作；每個專案可以擁有多個、名稱獨立的看板，而且
使用者只需管理自己參與的專案。這不是單純新增看板切換器，必須同時引入專案邊界、
個人身分、角色授權、封存、活動 Log 及按看板隔離的同步狀態。

## 2. 已確認的產品決策

1. 需要不同管理層級。
2. 一般使用者不應看到或管理未參與的專案。
3. 不提供一般使用者永久刪除；使用封存，之後仍可查看內容與 Log。
4. 第一階段需要專案內總覽，但不需要跨全部專案的 portfolio dashboard。
5. 使用者從「我的專案」進入個別專案，再查看該專案的總覽與看板。
6. Project 與 Board 都有自己的名稱；兩者名稱沒有相等限制。

## 3. v1 核准決策

以下決策已核准，實作不得自行擴張或改變：

1. 權限以 Project 為管理邊界；v1 不做 Board-specific ACL。
2. Project 內的所有成員都能看見該 Project 的所有 Board，能力由專案角色決定。
3. Workspace owner/admin 可以看見全體 Project 的管理用 metadata，但不能讀取
   Board、Card、Attachment、Report 或 Log，除非自己也是該 Project 的成員。
4. Workspace owner/admin 建立 Project，建立者預設成為該 Project 的 manager；
   可在指派其他 manager 後退出專案。
5. Project 與 Board 都支援封存及還原；封存後唯讀。
6. 封存資料與 Log 在 v1 不自動過期；永久刪除只保留為需備份與明確批准的維運操作。
7. Project/Board 建立、角色變更、封存及還原需要在線；Card 編輯維持離線優先。
8. 同一 Workspace 內 active Project 名稱不分大小寫唯一；同一 Project 內 active
   Board 名稱不分大小寫唯一。還原遇到衝突時必須先重新命名。
9. 每位使用者使用自己的 Bearer token；禁止多人共用同一 token。
10. v1 只支援單一 Workspace，但資料表與 API 保留 `workspaceId`，避免未來破壞性重做。

## 4. 目標

### 4.1 使用者目標

- 登入同步服務後，只看到自己參與的 active Project。
- 可在同一個 Project 中建立多個名稱獨立的 Board。
- 進入 Project 後看到該 Project 的進度總覽、Board 清單、成員與活動 Log。
- 進入 Board 後沿用目前 Kanban、附件、月報與離線同步體驗。
- Project manager 可管理成員、角色、Board、封存與還原。
- 封存後仍可查閱 Project／Board、月報、附件與 Log，但不能修改。

### 4.2 系統目標

- 所有讀寫都在 Worker 端驗證 Workspace 與 Project membership。
- Board revision、local cache、同步 queue 與 R2 objects 按 Board 隔離。
- 不同 Project 間不會因錯誤 URL、token、queue 或附件 key 洩漏資料。
- 現有單一 Board 能遷移到預設 Project／Board，不遺失卡片、附件 ref、完成日期或墓碑。
- production 既有 3a client 在過渡期仍可存取同一個 legacy Board。

## 5. 明確不做

- 跨所有 Project 的統計、排行、資源配置或 portfolio dashboard。
- Board-specific membership、Card-specific ACL 或欄位級權限。
- Project 之間的依賴關係、共同里程碑或跨 Project 搬卡。
- 即時多人游標、WebSocket 推播或逐事件 CRDT。
- OAuth、SSO、自助註冊、密碼重設或公開邀請連結。
- 一般 UI 的永久刪除。
- 已安裝原生 App 的遠端動態名稱更新。
- 自訂角色或自訂 permission set。

## 6. 資訊架構

```text
Workspace
├── Users / Workspace roles
└── Projects
    ├── Project members / Project roles
    ├── Project overview
    ├── Project activity log
    └── Boards
        ├── BoardState
        │   ├── Columns
        │   └── Cards
        │       └── Attachments
        └── Board activity log
```

全域 `app-config.json` 的 App title 與 Project/Board 名稱彼此獨立。

## 7. 角色與授權

### 7.1 Workspace roles

| 角色 | 能力 |
| --- | --- |
| `owner` | 管理 workspace admins、users、token 與 workspace 設定；包含 admin 能力 |
| `admin` | 建立 Project、停用 user、簽發／撤銷 token、查看 Project 管理 registry |
| `member` | 沒有 workspace 管理權；只透過 Project membership 存取工作內容 |

Workspace 管理 registry 只能顯示 Project ID、名稱、狀態、manager 名單、建立／更新時間；
不得回傳 Board 名稱、Card 數量、附件、月報或 Log。若 owner/admin 需要查看專案內容，
必須把自己加入 `project_members`，該事件要寫入 Log。

### 7.2 Project roles

| 能力 | `manager` | `contributor` | `viewer` |
| --- | :---: | :---: | :---: |
| 查看 Project 與 Board | ✓ | ✓ | ✓ |
| 查看 Project summary、月報與 Log | ✓ | ✓ | ✓ |
| 新增／編輯／移動 Card | ✓ | ✓ | — |
| 新增／下載／移除 Attachment | ✓ | ✓ | 僅下載 |
| 建立／重新命名 Board | ✓ | — | — |
| 封存／還原 Board | ✓ | — | — |
| 修改 Project 名稱 | ✓ | — | — |
| 管理 Project members 與角色 | ✓ | — | — |
| 封存／還原 Project | ✓ | — | — |

### 7.3 授權規則

- 同一 user 可在不同 Project 擁有不同角色。
- Project 至少要有一位 active manager；不可移除或降級最後一位 manager。
- `GET /projects` 只回傳呼叫者的 memberships。
- 無 membership 的資源回 404，避免洩漏 Project／Board 是否存在。
- 已有 membership 但能力不足時回 403。
- 未帶 token、token 錯誤、撤銷或 user 停用時回 401。
- 角色與 user ID 一律由 Worker 根據 token 查出；不信任 client 傳入的 actor 或 role。

## 8. 領域模型

所有 ID 使用 client/server 都可產生的 UUID 字串；名稱 trim 後長度為 1–80 字元。
所有時間使用 UTC ISO-8601。

### 8.1 Workspace

```ts
type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
```

### 8.2 User 與 AccessToken

```ts
type User = {
  id: string;
  displayName: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

type AccessToken = {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
```

Token 明文只在簽發時顯示一次。D1 只存 SHA-256 hash；Log 不記 token、hash 或
Authorization header。v1 可讓同一 user 為 Web、iOS、Android 分別持有 token，以便
只撤銷遺失裝置。

### 8.3 Project

```ts
type Project = {
  id: string;
  workspaceId: string;
  name: string;
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
};

type ProjectMembership = {
  projectId: string;
  userId: string;
  role: "manager" | "contributor" | "viewer";
  createdAt: string;
  updatedAt: string;
};
```

### 8.4 Board

Board metadata 與既有 `BoardState` 分開。Project 名稱不會複製成 Board 名稱，也不會
在任一方改名時連動。

既有 `Card.members: string[]` 在 v1 保留為卡片上的顯示文字，不是 Project membership
或授權依據，也不會因成員移除而自動改寫。卡片正式多人指派已由
`2026-07-30-multi-assignee-tasks-design.md` 的 v1.1 規格新增為 `assigneeUserIds`；
Project membership 仍是唯一授權來源。

```ts
type BoardRecord = {
  id: string;
  projectId: string;
  name: string;
  status: "active" | "archived";
  revision: number;
  data: BoardState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
};
```

每個 Project 可有 0..N 個 Board。建立 Project 時 UI 預設提供「建立第一個看板」，
但資料層不強迫一定存在 Board。

### 8.5 ActivityLog

```ts
type ActivityLog = {
  id: string;
  workspaceId: string;
  projectId: string;
  boardId: string | null;
  actorUserId: string;
  action: string;
  entityType: "project" | "membership" | "board" | "card" | "attachment";
  entityId: string;
  revision: number | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};
```

Log 是 append-only，由 Worker 產生，client 不可自行新增、修改或刪除。

## 9. D1 概念 schema

下一個 migration 建立：

- `workspaces`
- `workspace_members`
- `user_accounts`（v2 的 User；保留 legacy `users` 給舊 Worker）
- `access_tokens`
- `projects`
- `project_members`
- `boards`
- `activity_logs`
- `migration_state`

實體表使用 `user_accounts`，避免 schema migration 後、Worker 切換前讓仍在服務的 3a
Worker 找不到原 `users`。等所有舊 client 與 Worker 相容路徑下線後，才另案清理或重新
命名；本次不可直接 rename/drop legacy `users` 或 `board`。

必要索引：

- `access_tokens(token_hash)` unique
- `workspace_members(workspace_id, user_id)` unique
- `project_members(project_id, user_id)` unique
- `projects(workspace_id, status, updated_at)`
- active Project normalized name unique
- `boards(project_id, status, updated_at)`
- active Board normalized name在 Project 內 unique
- `activity_logs(project_id, occurred_at, id)`
- `activity_logs(board_id, occurred_at, id)`

Board update 與對應 Log 必須原子化；若 Log 無法寫入，Board mutation 不得回成功。

## 10. Project 頁面與導覽

### 10.1 我的專案

啟動及完成認證後顯示「我的專案」：

- 只列出呼叫者有 membership 的 Project。
- active／archived 分頁。
- 顯示 Project 名稱、自己的角色、active Board 數及最後活動時間。
- 不顯示跨 Project 合計、排名或進度 KPI。
- 無 membership 時顯示空狀態，不顯示其他 Project。

### 10.2 Project overview

進入 Project 後顯示：

- Project 名稱與目前 user 角色。
- active Board 清單及各 Board 的摘要。
- 專案層級總覽：總工作、進行中、完成、逾期。
- 最近六個日曆月的完成數，彙總該 Project 的 active Board。
- archived Board 分頁。
- Activity Log。
- manager 才顯示成員管理、Project／Board 建立、改名、封存及還原動作。

archived Board 預設不納入 summary；可用「包含封存看板」唯讀篩選重新計算。

### 10.3 Board

Board 頁面沿用目前 Kanban，新增：

- Breadcrumb：`我的專案 / {Project name} / {Board name}`。
- 同 Project 的 Board switcher。
- Board 名稱與封存狀態。
- archived Board 顯示唯讀 banner，隱藏所有 mutation controls。
- 月報預設顯示目前 Board；Project overview 顯示 Project aggregation。

## 11. 專案總覽與報表語意

- Project summary 只聚合該 Project 的 Board。
- 預設只計 active Board；archived Board 必須由使用者明確勾選。
- Card 數量按 Board 直接相加；Card ID 只要求 Board 內唯一。
- 完成月份仍使用 `completedAt`，維持最近六個日曆月且包含零資料月份。
- Project 改名、Board 改名或 Card 完成後再編輯，不改變歷史完成月份。
- v1 不產生全 Workspace summary API。

## 12. 封存、還原與 Log

### 12.1 封存

- Project manager 可封存 Project 或 Board。
- 封存 Project 會讓其所有 Board 有效唯讀，但不必逐列改寫 Board status。
- 封存 Board 只影響該 Board。
- 封存不刪 D1 row、不刪 R2 object、不清本機 cache。
- 封存後 GET、附件下載、summary 與 Log 仍可使用。
- 封存後所有 Board／Attachment mutation 回
  `409 { "error": "resource_archived" }`。

### 12.2 還原

- Project manager 可還原。
- 還原 Project 不自動還原之前已個別封存的 Board。
- active 名稱衝突時回 409，要求先重新命名。
- 還原事件寫入 ActivityLog。

### 12.3 Log 粒度

至少記錄：

- Project create、rename、archive、restore。
- Membership add、role change、remove。
- Board create、rename、archive、restore。
- 每次成功 Board revision 的 actor、前後 revision 與 server-side diff。
- diff 內含 Card create、changed fields、move、complete、reopen、delete。
- diff 內含 Attachment reference add/remove；不記錄檔案內容或 Bearer token。

離線期間的多個本機操作若合併成一次 PUT，Log 反映成功同步前後的最終 diff，不保證
重建每一個離線中間步驟。每個 Board revision 寫一筆 `board.content_updated` Log，
`metadata.changes` 最多保存 200 個詳細變更；超過時保存各類型 count 並標記
`truncated: true`，避免單次 1 MiB Board 更新造成無界 Log transaction。Log 預設依
時間倒序，cursor pagination，預設 50、上限 200。

## 13. Worker API v2

所有 endpoint 皆需 Bearer token；回應維持 JSON error envelope 與 `X-Request-Id`。

### 13.1 身分與 Project

```text
GET    /me
GET    /projects
POST   /projects
GET    /projects/:projectId
PATCH  /projects/:projectId
POST   /projects/:projectId/archive
POST   /projects/:projectId/restore
GET    /projects/:projectId/summary
GET    /projects/:projectId/logs
```

### 13.2 Project members

```text
GET    /projects/:projectId/members
PUT    /projects/:projectId/members/:userId
DELETE /projects/:projectId/members/:userId
```

`DELETE` membership 只移除存取權，不刪除 user 或歷史 Log。

### 13.3 Boards

```text
GET    /projects/:projectId/boards
POST   /projects/:projectId/boards
GET    /projects/:projectId/boards/:boardId
PATCH  /projects/:projectId/boards/:boardId
PUT    /projects/:projectId/boards/:boardId/content
POST   /projects/:projectId/boards/:boardId/archive
POST   /projects/:projectId/boards/:boardId/restore
GET    /projects/:projectId/boards/:boardId/logs
```

`PUT .../content` 沿用 `{ baseRevision, board }`：

- revision 是每個 Board 各自獨立。
- base revision 相符才寫入並 `revision + 1`。
- 不符回 409，包含最新 revision 與 BoardState。
- archived Project／Board 不接受 content mutation。

### 13.4 Attachments

```text
PUT    /projects/:projectId/boards/:boardId/attachments/:attachmentId
GET    /projects/:projectId/boards/:boardId/attachments/:attachmentId
DELETE /projects/:projectId/boards/:boardId/attachments/:attachmentId
```

Worker 必須先驗證 Project membership、Board 所屬 Project 與角色，再存取 R2。
Attachment PUT/DELETE 只允許 manager/contributor；GET 允許所有 Project members。

### 13.5 管理 API

Workspace owner/admin 的 user、token 與 Project registry API 放在 `/admin/*`，不和一般
Project endpoint 混用。v1 可先保留 CLI／受限維運流程，但資料模型與 Worker authz
必須支援個人 token；不能繼續用多人共用 token 模擬角色。

## 14. R2 key 與附件隔離

R2 bucket 維持每個環境一個 private bucket，key 改為：

```text
workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/attachments/{attachmentId}
```

規則：

- client 不可傳完整 R2 key；Worker 由已授權的路徑參數組合。
- queue item 必須包含 `workspaceId`、`projectId`、`boardId`、`attachmentId` 與 endpoint。
- 同一 attachment ID 在不同 Board 不會碰撞。
- 封存不刪 object。
- 永久刪除若未來加入，必須先產生清單、備份並由明確維運程序執行。

## 15. 本機資料與離線模型

### 15.1 建議 storage keys

```text
kanban-workspace-index-v1
kanban-active-context-v1
kanban-board-v1:{boardId}
kanban-sync-revision-v2:{boardId}
kanban-attachment-queue-v2
kanban-sync-config-v2
```

`active-context` 儲存最近的 `projectId`、`boardId`。Project index 只作離線導覽 cache，
server membership 才是授權真相。

### 15.2 離線行為

- 已在本機開啟過的 Project／Board 可離線查看。
- active Board 可離線新增、編輯、移動、完成 Card 及加入本機 Attachment。
- 每個 Board 有自己的 revision 與 push debounce。
- queue 按 endpoint + user + project + board 隔離。
- 離線時不可建立 Project／Board、改角色、封存或還原；UI 顯示需連線。
- 使用者失去 membership 後，下次連線立即停止同步並清除 token 對該 Project 的可用
  index；本機 cache 不自動銷毀，提供「匯出或清除本機副本」提示。
- Board 在別處被封存而本機仍有 pending mutation 時，保留本機資料並提示匯出、
  manager 還原或捨棄 pending changes，不自動覆蓋。

## 16. 認證升級

現有 `users.token_hash` 只能代表一個 token。v1 的新 API 改用：

1. `user_accounts` 只保存身分與狀態。
2. `access_tokens` 保存多個可撤銷 token hash。
3. authenticate 回傳完整 `AuthenticatedUser`，不再只有 boolean。
4. 每個 request 先取得 user，再做 Workspace／Project role 檢查。
5. token rotation 不改 Project memberships 或 ActivityLog actor。

現有 production shared token 在 v2 cutover 前必須停止共享並換發個人 token。若無法確認
舊 token 的實際使用者，Log actor 不可偽裝成某位成員；過渡期 actor 使用明確的
`legacy-shared-user`，並在切換完成後撤銷。

## 17. 舊資料遷移與相容

### 17.1 D1

採兩階段切換，避免 schema migration 與 Worker deploy 的空窗遺失最後寫入：

1. D1 migration 只新增 v2 tables 與 `migration_state`；保留 legacy `users`、`board`，
   不立即複製 Board。
2. 3a Worker 在新 Worker 上線前仍只讀寫 legacy tables，不受 additive migration 影響。
3. 新 Worker 在 migration 未完成時，legacy `/board` 仍讀寫舊 `board`，v2 Project API
   回 `503 migration_required`。
4. 明確的 migration command 先把 `/board` PUT 置於短暫 retryable lock，再讀取最新
   legacy row。
5. 在同一受控切換中建立預設 Workspace、legacy Project／Board，複製最新
   BoardState JSON、revision、`completedAt`、attachment refs 與 deletedCards。
6. 管理者確認 user 對應、個人 tokens、Workspace owner 與 Project memberships。
7. `migration_state` 標記完成後，`/board` alias 改讀寫同一筆新版 Board row並解除 lock。
8. 舊 shared token 標記為 legacy，完成 client 升級後撤銷。

禁止長期 dual-write；lock 期間的 client PUT 應收到 retryable 503 並保留本機 pending
data。切換 script 失敗時不得標記完成，legacy Board 仍是權威來源。

### 17.2 API 過渡

- `/board` 在一個相容發布週期內作為 legacy Board alias。
- migration 完成前 alias 讀寫 legacy `board`；短暫 migration lock 時 PUT 回 retryable
  503；完成後 alias 只讀寫同一筆新版 Board row。
- 任一時間只允許一個權威 Board row，不可維護長期 dual-write。
- 舊 `/attachments/:fileName` 只有 production 已存在物件時才需要 alias；目前正式 R2
  尚未建立，因此應在 staging 前直接採新版 board-scoped endpoint。
- 所有支援的 client 升級後，另案移除 legacy alias 與舊 `board` table。

### 17.3 本機

- 偵測到舊 `kanban-pwa-board-v1` 且沒有新版 index 時，建立 legacy local context。
- 連上新版 server 後，顯示「合併本機資料」或「採用遠端資料」，不可靜默覆蓋。
- attachment queue v1 遷移時必須補上 legacy Project/Board ID；無法判定時暫停 queue
  並提示，不把物件送到猜測的 Board。

## 18. 錯誤與狀態

| 狀況 | HTTP | Client 行為 |
| --- | --- | --- |
| token 缺失／錯誤／撤銷 | 401 | 要求重新設定；保留本機資料 |
| 有 membership 但角色不足 | 403 | 隱藏或停用動作並說明 |
| 不屬於 Project 或資源不存在 | 404 | 不揭露資源存在 |
| revision 或 active name 衝突 | 409 | 拉取合併或要求改名 |
| Project／Board 已封存 | 409 `resource_archived` | 轉唯讀並保留 pending data |
| payload 或 ID 格式錯誤 | 400 | 顯示可修正訊息 |
| Board／Attachment 超限 | 413 | 不上傳、不更新遠端 ref |
| 暫時性錯誤 | 5xx／network | queue 保留並退避重試 |

## 19. 安全與隱私

- 每個 API request 都做 server-side membership 與 role 檢查。
- R2 永不公開；Attachment 只能經 Worker。
- 不把 token、token hash、附件內容或完整 Authorization header 寫入 Log。
- ActivityLog 可包含 Card title、Board name、欄位移動與 changed field names，但不記
  Card description 的完整前後內容。
- Project list 不可因 client filter 錯誤而回傳未參與 Project。
- owner/admin 加入 Project、角色變更與 token 撤銷都要留下 audit event。
- CORS `*` 可為 Web + Capacitor 保留，但不能取代 token 與 ACL。

## 20. 驗收準則

### 20.1 可見性與角色

- [ ] User A 只看到自己參與的 Project，無法列出或猜測 User B 的 Project。
- [ ] 同一 user 可在 Project X 當 manager、Project Y 當 viewer。
- [ ] workspace admin 未加入 Project 時只看得到管理 metadata，無法讀 Board。
- [ ] contributor 可改 Card，但不能管理成員或封存 Board。
- [ ] viewer 可查看 Board、Attachment、summary 與 Log，但所有 mutation 被拒絕。
- [ ] 最後一位 Project manager 不可被移除或降級。

### 20.2 Project／Board

- [ ] Project 與 Board 名稱可不同，改名互不影響。
- [ ] 一個 Project 可建立多個 Board，revision 與 sync status 彼此獨立。
- [ ] active name 重複回 409；不同 Project 可使用相同 Board name。
- [ ] 我的專案沒有跨 Project KPI。
- [ ] Project overview 只聚合該 Project，預設排除 archived Board。

### 20.3 封存與 Log

- [ ] 封存 Board／Project 後內容與附件仍可讀，所有 mutation 被拒絕。
- [ ] 還原後可繼續同步，既有 revision 與資料不重置。
- [ ] Project/Board lifecycle、membership 與成功 Board revisions 都有 actor/timestamp。
- [ ] archived Board 可查看歷史 Log。
- [ ] Log 不含 token、附件 bytes 或 Card description 完整內容。

### 20.4 離線與隔離

- [ ] 離線切換已快取 Board 不會混用資料。
- [ ] 每個 Board revision、debounce 與 queue 獨立。
- [ ] 切換 user/token/endpoint/project/board 不會送出舊 context 的 queue。
- [ ] 失去 membership 或遠端封存時，pending local data 不被靜默刪除。
- [ ] R2 key 含 Workspace/Project/Board，跨專案無法存取。

### 20.5 遷移

- [ ] production 單一 Board 遷移後內容、revision、月報與墓碑不變。
- [ ] 舊 client 經 `/board` alias 和新 client 讀寫同一筆 Board。
- [ ] 舊 local board 首次升級會讓使用者選擇 merge 或 remote。
- [ ] shared token 完成個人化與撤銷，不留下匿名長期存取。

## 21. 實作順序

1. **Domain 與 local migration**
   - Project/Board metadata types、local index、active context、per-board revision。
2. **D1 schema 與 identity**
   - Workspace、users、access tokens、projects、memberships、boards、logs。
3. **Worker authz 與 API v2**
   - `/me`、Project、members、Board content、archive/restore。
4. **Web/App 導覽**
   - 我的專案、Project overview、Board switcher、role-aware controls。
5. **附件與 queue v2**
   - nested endpoint、board-scoped R2 key、context-isolated queue。
6. **Project summary 與 ActivityLog**
   - server diff、pagination、archived filters。
7. **Legacy migration 與 alias**
   - D1 copy、local prompt、個人 token 切換。
8. **staging**
   - 建立遠端資源後跑角色、隔離、雙裝置與實機驗收。

在實作計畫 Task 1–13 完成並通過本機自動化前，不建立 staging；在 staging 全部通過
前，不修改 production 3a 或建立 production R2。

## 22. 已核准約束

使用者已接受以下五個 v1 約束：

1. 權限只到 Project 層，不做 Board-specific ACL。
2. workspace owner/admin 未加入 Project 時不能讀內容。
3. Project 與 Board 都是 archive/restore，沒有一般永久刪除。
4. ActivityLog 長期保留，離線批次只記最終 server diff。
5. Project／Board 管理操作需要連線，只有 Board 內容離線優先。
