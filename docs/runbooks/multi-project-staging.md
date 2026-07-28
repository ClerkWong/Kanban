# Multi-project staging 建立與重設 Runbook

最後更新：2026-07-27

## 適用範圍與安全界線

本文件只適用於 `kanban-sync-staging` 與
`kanban-attachments-staging`。Task 14 的 release commit、fresh-clone gate 與原生
build 尚未完成前，不得執行本文件的遠端建立或部署命令。Production 不得用來做
multi-project migration、角色或附件測試。

- 指定一位 staging operator，所有遠端命令由同一人記錄 commit SHA 與時間。
- 執行前確認 Git 工作樹乾淨，且 `worker-sync/wrangler.jsonc` 的 staging binding
  沒有 production resource ID 或 bucket name。
- token 明文只能存在密碼管理器與使用者裝置；不得放入 repo、命令列參數、CI、
  ticket、螢幕截圖或測試輸出。
- D1 export、legacy snapshot 與 client backup 可能含工作內容，必須存入權限受控位置。
- 下列「建立／migration／deploy／reset」命令都會改變 Cloudflare 遠端狀態，必須在
  Task 14 commit 推送後另行明確執行。

Cloudflare 參考：

- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [R2 建立 bucket](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [R2 清空／刪除 bucket](https://developers.cloudflare.com/r2/buckets/delete-buckets/)

## 目前 staging inventory

以下資源已於 2026-07-27 建立，production 資源未變更：

| 類型 | staging 值 |
| --- | --- |
| Worker URL | `https://kanban-sync-staging.clerk-wong.workers.dev` |
| Worker deployment | `2280664a-b7cc-4511-9096-d65a37f1096e` |
| D1 | `kanban-sync-staging` / `bcae6724-352b-453d-92e4-28bcf229f76f` |
| R2 | private `kanban-attachments-staging` |
| Owner user | `a14c7f5d-4c2e-4be2-8896-07652625d722` |
| Token inventory | personal label `owner-web`，建立日期 2026-07-27 |
| 本機保管位置 | macOS Keychain service `com.wongchambers.kanban.staging.sync-token`、account `staging-owner` |

Token 明文與 hash 不得加入本表。撤銷時依
[token-lifecycle.md](./token-lifecycle.md) 先建立替代 token、驗證，再以 token ID 撤銷；
Keychain locator 只用於目前 staging operator 的本機 smoke test。

## 1. 固定 release candidate

在預定 commit 的 fresh clone 執行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:release:migration
pnpm worker:test
pnpm worker:test:release
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

另須完成 Android debug 與 `CODE_SIGNING_ALLOWED=NO` 的 iOS simulator build。記錄：

- release commit SHA；
- Node、pnpm、Wrangler、Xcode、Java/Gradle 版本；
- 單元與 Worker runtime test 數量；
- Android APK 與 iOS simulator build 結果；
- `git status --short` 為空。

## 2. 建立完全隔離的資源

先確認登入的 Cloudflare account，且不是其他組織的帳號：

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec wrangler whoami
```

建立 staging D1，將回傳的 `database_id` 寫入
`worker-sync/wrangler.jsonc` 的 `env.staging.d1_databases[0]`。不得複製 production
ID：

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec wrangler d1 create kanban-sync-staging
```

建立 private R2 bucket。不要設定公開網域：

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec wrangler r2 bucket create kanban-attachments-staging
```

重新產生 bindings type、檢查差異，再套用 staging migrations：

```bash
pnpm worker:types
pnpm typecheck
pnpm sync:migrate:staging
```

## 3. 建立 Workspace owner 與個人 token

為 owner 準備固定 UUID，token 由密碼管理器產生至少 32 個不含空白的高熵字元。
明文透過互動提示輸入，不放在命令列：

```bash
pnpm sync:bootstrap \
  --target staging \
  --user-id "OWNER_UUID" \
  --display-name "Staging Owner" \
  --workspace-name "Kanban Staging" \
  --token-label "owner-web"
```

此命令只適合初始 Workspace owner。它會建立／更新 owner、personal token，並在有
legacy Project 時建立 manager mapping；不可拿來建立一般成員。

### 建立一般 user account

先在 repo 外建立權限 `0600` 的暫存 SQL，將 `USER_UUID`、顯示名稱與
`member`／`admin` role 換成核准值。一般 Project 使用者應是 Workspace `member`：

```sql
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
INSERT INTO user_accounts (id, display_name, status, created_at, updated_at)
VALUES (
  'USER_UUID',
  'DISPLAY_NAME',
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  status = 'active',
  updated_at = excluded.updated_at;
INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'USER_UUID',
  'member',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(workspace_id, user_id) DO UPDATE SET
  role = excluded.role,
  updated_at = excluded.updated_at;
COMMIT;
```

先人工檢查 SQL 只指向 staging UUID，再執行：

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec wrangler d1 execute kanban-sync-staging \
  --remote --env staging --file /secure/tmp/provision-user.sql \
  -c worker-sync/wrangler.jsonc
```

安全刪除暫存 SQL，接著以隱藏提示為該 user 建立個人 token：

```bash
pnpm sync:token create \
  --target staging \
  --user-id "USER_UUID" \
  --label "alice-web"
```

每個人、每台裝置各用一枚 token。詳細建立、輪替、撤銷與裝置遺失流程見
[token-lifecycle.md](./token-lifecycle.md)。

## 4. 部署與 Project roles

Fresh staging 不含 legacy `board` row；bootstrap 會讓 migration state 進入
`complete`，不應執行 legacy copy。只有刻意匯入舊版 snapshot 的演練環境，才依
README 的 legacy runbook 執行 `sync:migrate:legacy`。

部署 staging Worker：

```bash
pnpm sync:deploy:staging
```

用 owner token 登入新版 Web/App：

1. 建立 Project；建立者自動成為 Project manager。
2. 在 Project 成員管理中，以固定 user UUID 加入 `manager`、`contributor` 或
   `viewer`。
3. 確認沒有 Project membership 的 Workspace admin/member 只能看到其管理範圍，
   不能讀 Project content。
4. 至少建立 Board A 與 Board B，名稱與 Project 名稱不同，以便驗證隔離。

角色矩陣：

| 操作 | manager | contributor | viewer | 無 membership |
| --- | --- | --- | --- | --- |
| 讀 Board／附件／summary／Log | 允許 | 允許 | 允許 | 404 |
| 修改 Card、上傳／刪除附件 | 允許 | 允許 | 403 | 404 |
| 管理成員、Project、Board lifecycle | 允許 | 403 | 403 | 404 |

## 5. Smoke 與驗收證據

從密碼管理器把 token 注入暫時環境，不要把明文直接寫入 shell history：

```bash
KANBAN_SYNC_URL="https://STAGING_WORKER_HOST" \
KANBAN_SYNC_TOKEN="<由安全環境注入>" \
pnpm sync:smoke
```

至少記錄：

- 無 token、錯 token、已撤銷 token 都是 401；
- `/me` 的 user 與 `tokenKind=personal` 正確；
- Project list 只含 caller membership；
- Board A/B revision、local cache、queue 與 R2 key 不互相污染；
- viewer/outsider、archive read-only 與 legacy `/board` alias 行為；
- Worker log 沒有 Authorization header、token/hash、Card description 或附件 bytes。

## 6. Staging 協調重設

此流程清除 Project、Board、Activity Log、legacy board 與全部 staging R2 objects，
但保留 Workspace、user accounts、workspace roles 與 personal tokens。R2 清空不可
復原；若附件仍需保留，先以受控的 S3/R2 工具備份，不得繼續本流程。

### 6.1 凍結與備份

1. 通知測試者關閉 staging client，停止自動化寫入。
2. 記錄 release SHA、D1/R2 名稱與執行人。
3. 取得 D1 Time Travel bookmark。
4. 匯出 staging D1 到 repo 外的權限受控路徑。
5. 記錄 R2 object 數量；若需保留，完成物件備份與抽樣還原測試。

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec wrangler d1 time-travel info kanban-sync-staging \
  --env staging -c worker-sync/wrangler.jsonc

WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec wrangler d1 export kanban-sync-staging \
  --remote --env staging --output /secure/backup/staging-before-reset.sql \
  -c worker-sync/wrangler.jsonc
```

### 6.2 清除 D1 content

在 repo 外建立權限 `0600` 的 `staging-reset.sql`。下列 SQL 先移除 append-only
triggers，在同一 transaction 清除 Log 與 content，再原樣重建 triggers：

```sql
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
DROP TRIGGER activity_logs_no_update;
DROP TRIGGER activity_logs_no_delete;
DELETE FROM activity_logs;
DELETE FROM boards;
DELETE FROM project_members;
DELETE FROM projects;
DELETE FROM board;
UPDATE migration_state
SET status = 'complete',
    locked_at = NULL,
    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    error = NULL
WHERE id = 1;
CREATE TRIGGER activity_logs_no_update
BEFORE UPDATE ON activity_logs
BEGIN
  SELECT RAISE(ABORT, 'activity_logs are append-only');
END;
CREATE TRIGGER activity_logs_no_delete
BEFORE DELETE ON activity_logs
BEGIN
  SELECT RAISE(ABORT, 'activity_logs are append-only');
END;
COMMIT;
```

逐行比對 table/trigger 名稱後才執行：

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  pnpm exec wrangler d1 execute kanban-sync-staging \
  --remote --env staging --file /secure/tmp/staging-reset.sql \
  -c worker-sync/wrangler.jsonc
```

若 D1 command 失敗，停止；不得清空 R2。確認 D1 content counts 都為 0、身份資料仍在，
且兩個 append-only triggers 已恢復後，才進下一步。

### 6.3 清空 R2

在 Cloudflare Dashboard 打開 **R2 → `kanban-attachments-staging` → Settings →
Empty Bucket**，再次核對 bucket 名稱後確認。Empty Bucket 會保留 bucket 與設定；
不要刪除 bucket，也不要對 production bucket 操作。

D1 已不再引用附件，因此 D1 先清除、R2 後清空的短暫中間狀態只會留下不可見 orphan，
不會產生對已刪 object 的有效 Board reference。等待 Dashboard 顯示完成，再確認 object
count 為 0。

### 6.4 重設後驗證

1. `/me` 與 personal tokens 仍有效。
2. `/projects` 為空，`/board` 回 empty/not-found，而不是 500。
3. 建立新 Project/Board、上傳與下載一個測試附件。
4. viewer/outsider 與 archive read-only 再跑一次。
5. 確認新 Log 只含重設後活動。

若需回復 D1，使用 6.1 的 bookmark/export 制定單獨事故計畫。D1 Time Travel 不會
回復已清空的 R2 objects，因此沒有附件備份時不得把 D1 還原到引用舊附件的狀態。
