# Kanban 後續任務與發布 Runbook

- 最後更新：2026-08-04
- 目前分支：`codex/platform-admin-user-entry`
- `main` 已整合多專案 v1：`d54e0ec`

本文件整併先前兩份規劃，是後續工作、驗收與發布順序的單一依據。
已完成的歷史實作只保留結果與證據；未完成項目依實際執行順序排列。

## 目前真實狀態

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| 單一專案看板與 admin/owner/member | 已完成並發布 Beta | Project 建立會同時建立唯一 Board 與初始 owner；member 可編輯任務；legacy viewer 僅唯讀；staging migration、Worker smoke 與 private Sites Beta v7 已完成 |
| 登入與使用者管理 | 已發布 Beta，待 owner 設定登入 | email/password session、登入限制、平台帳號建立／停用／角色／密碼重設、同 Workspace 使用者選單已發布為 Sites Beta v8；production 不變更 |
| 多專案 v1 合併 main | 已完成並推送 | `feature/multi-project-v1` 已於 `d54e0ec` 合併至 `main` |
| 平台管理者／一般使用者入口 | 第一階段實作中 | 一般使用者預設進「我的專案」；Workspace owner/admin 才可見平台管理入口、metadata registry 與建立專案功能 |
| 月報資料模型 | 已完成 | 以 `completedAt` 計算最近六個日曆月；schema v4 可遷移 v1/v2/v3 |
| 3b 附件用戶端 | 多看板同步層與 UI 已完成 | queue v2、下載與 R2 endpoint 已按 user/Project/Board/Attachment 隔離 |
| Worker 3b | 多專案後端已部署 staging | identity、ACL、Project/Board API、summary、Activity Log 與 scoped R2 API 已部署到隔離 staging；production 尚未部署 |
| 多專案／多看板規格 | 已核准 | 實作計畫位於 `docs/superpowers/plans/2026-07-24-multi-project-multi-board-v1.md` |
| 多專案 Milestone A | 已完成並推送 | Project domain／ACL capability、per-board storage 與可恢復 legacy migration |
| 多專案 Worker Task 3 | 已完成並推送 | additive D1 schema、append-only Activity Log constraints、個人／legacy token bootstrap；未套用遠端 |
| 多專案 Worker Task 4 | 已完成並推送 | HTTP/router、個人 identity、Project ACL、audit foundation；legacy API 保持相容 |
| 多專案 Worker Task 5 | 已完成並推送 | `/me`、Project lifecycle、membership 與 admin registry APIs；具備 last-manager guard、idempotency 與原子 audit |
| 多專案 Worker Task 6 | 已完成並推送 | multi-board metadata/content、per-board revision、archive/restore 與 migration-aware `/board` alias；未套用遠端 |
| 多專案 Worker Task 7 | 已完成並推送 | Project summary、六個月月報、server-side Board diff 與 Project/Board Activity Log cursor API；未套用遠端 |
| 多專案 Worker Task 8 | 已完成並推送 | Attachment API 與 R2 key 已限定到 Workspace/Project/Board；三角色與 archived read-only 已驗證，未套用遠端 |
| 多專案 Client Task 9 | 已完成並推送 | runtime `/me` session、Project/Board v2 client、scoped Attachment API、嚴格 parser 與統一錯誤 mapping |
| 多專案 Client Task 10 | 已完成並推送 | per-board store/revision/sync、queue v2、stale response suppression 與 legacy queue blocker |
| 多專案 Client Task 11 | 已完成並推送 | Web／Capacitor 共用 ProjectApp、我的專案、專案摘要、Board switcher、嚴格 hash route 與 viewer/archive 唯讀 UI |
| 多專案 Client Task 12 | 已完成並推送 | manager Project／Board lifecycle、成員角色、archived views、summary filter、Activity Log cursor 與離線管理 guard |
| 多專案 Task 13 | 已完成並推送 | legacy lock/copy/rollback、client merge/remote、一次性 backup、personal token 換發、verification script 與 E2E |
| 多專案 Task 14 | 已完成並推送 | staging-ready CI、fresh clone／原生完整關卡、受限 token CLI 與 staging/token/reset runbooks |
| 任務多人指派 v1.1 | 程式已完成，待發布 beta | Card schema v5、Project member 多選、Worker membership validation、離開成員保留與 assignment audit |
| staging 設定 | 已建立並部署 | staging Worker、D1、private R2、migration、owner 與 personal token 已完成；待 RC 多角色／多裝置驗收 |
| CI | 已完成 | PR/main 會驗證 Web、Worker、Android debug 與 iOS simulator |
| Web/PWA | private beta v3 已發布 | [Kanban Beta](https://kanban-beta-liddlefang.clerk-wong.chatgpt.site) 已更新至 `d43eb3f`；修正 personal token 首次連線誤呼叫 legacy `/board`，目前僅擁有者可存取 |
| Sites 關聯 | 已完成 beta 關聯 | `.openai/hosting.json` 已保存 beta `project_id`；Sites 本身不擁有同步 D1/R2 |
| 客製 title | 已完成並發布 beta | `public/app-config.json` 控制畫面與 WebView title；beta v3 已提供目前 JSON 值 |
| staging Worker/D1/R2/token | 已建立 | 和 production 完全隔離；URL 與非敏感 inventory 見 staging runbook |
| production Worker/D1 | 既有 3a 上線 | 尚未部署本次 3b Worker |
| production R2 | **尚未建立** | 必須等 staging 驗收全數通過 |
| iOS/Android | `1.1.0` 內測程式已建置，未完成發行 | 可管理工作流欄位的最新資產已同步至 `1.1.0 (4)`；Android debug、iOS simulator 與已簽署 iOS device build 通過，尚缺 build 4 實機 smoke test 與正式分發 |

### 已完成的驗證

- 已推送候選版曾通過 52 個單元測試、8 個 Worker runtime tests、lint、typecheck、
  Web/mobile build、production/staging Worker dry-run、Android debug build、未簽章
  iOS simulator build 與 final mobile sync。
- 客製 title 變更已通過 56 個單元測試、lint、typecheck、Web build、
  mobile build 與完整 `pnpm mobile:sync`。
- 多專案 Milestone A 已通過 104 個單元測試、lint、typecheck、Web build 與
  mobile build；localStorage 中斷後可重跑修復，原 legacy key 不刪除。
- 多專案 Task 3 已通過 112 個單元測試、8 個 Worker runtime tests、lint、typecheck，
  並以隔離本機 D1 驗證 fresh 與含 legacy board 的 0001→0002 路徑。
- 多專案 Task 4 已通過 112 個單元測試、12 個 Worker runtime tests、lint、typecheck，
  以及 production/staging Worker dry-run；未部署。
- 多專案 Task 5 已通過 112 個單元測試、21 個 Worker runtime tests、lint、typecheck、
  typed `no-floating-promises` 檢查，以及 production/staging Worker dry-run；另驗證 audit
  寫入失敗時 Project mutation 會完整回滾，未部署。
- 多專案 Task 6 已通過 113 個單元測試、33 個 Worker runtime tests、lint、typecheck、
  typed `no-floating-promises` 檢查，以及 production/staging Worker dry-run；已驗證
  Board A/B revision 隔離、concurrent write、archive/restore、audit rollback，與 `/board`
  在 migration pending／locked／complete 的單一權威資料切換，未部署。
- 多專案 Task 7 已通過 115 個單元測試、40 個 Worker runtime tests、lint、typecheck；
  已驗證 Project/Board Log 隔離、同 timestamp cursor、archived history、summary archived
  filter、六個月零值與 audit 隱私，且 Task 6 audit rollback 測試持續通過，未部署。
- 多專案 Task 8 已通過 115 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  generated Worker types check 與 production/staging Worker dry-run；已驗證三角色權限、
  Project/Board R2 key 隔離、archived read-only、10 MiB 邊界，及 authz failure 不碰 R2，
  未部署。
- 多專案 Task 9 已通過 124 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build 與 mobile build；已驗證 nested resource path、嚴格 response parser、
  401/403/404/409/archived mapping，以及 token/user 切換不會沿用舊 session 或刪除本機
  Board data。
- 多專案 Task 10 已通過 133 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build 與 mobile build；已驗證 Board A/B queue 並行安全、完整 scope 隔離、
  stale response suppression、pending upload gate、archived/403/404 停止自動重試，
  以及舊 queue/revision 的安全 migration blocker。
- 多專案 Task 11 已通過 137 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build 與 mobile build；已驗證嚴格 hash routing、無權 context fallback、
  Project role／archive 唯讀 actions，以及 scoped 附件重試下載。
- 多專案 Task 12 已通過 140 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build、mobile build 與完整 mobile sync；已驗證 manager-only actions、
  last-manager guard、archived read-only、Log filter/cursor、summary archived filter
  與離線管理操作不進 queue。
- 多專案 Task 13 已通過 144 個單元測試、48 個 Worker runtime tests、lint、typecheck、
  Web/mobile build、Worker types check 與 production/staging dry-run；已驗證 legacy
  lock/copy/rollback、merge/remote、一次性 backup、personal token 驗證後撤銷 shared
  token，以及角色、Board 隔離、archive 與 alias authority E2E。
- 多專案 Task 14 已在 `fb7c609` 的 fresh clone 通過 frozen install、150 個單元測試、
  48 個 Worker runtime tests、12 個 client migration 與 8 個 role/legacy alias
  release tests、lint、typecheck、Web/mobile build、Worker types、production/staging
  dry-run、final mobile sync、Android debug 與未簽章 iOS simulator build。Artifact
  fixture-token 與 tracked secret-file scan 無命中。
- staging 候選 `de24a29` 已在 fresh clone 通過 frozen install、153 個單元測試、
  48 個 Worker runtime tests、12 個 client migration 與 8 個 role/legacy alias
  release tests、lint、typecheck、Web/mobile build、generated Worker types、
  production/staging dry-run、final mobile sync、Android debug 與未簽章 iOS simulator
  build。另掃描 362 個 tracked/log/build artifact files，staging token 與 token hash
  均為 0 命中。
- personal token 首次連線修正 `d43eb3f` 已通過 156 個單元測試、lint、typecheck、
  Web build 與 mobile build；personal token 驗證 `/me` 後會直接重新載入
  ProjectApp，不再要求 fresh multi-project staging 提供 legacy `/board`。
- 任務多人指派 v1.1 已通過 159 個 client tests、49 個 Worker tests、8 個 release
  tests、lint、typecheck、Web/mobile build 與 staging Worker dry-run。Board schema
  v5 migration 保留 v4 `completedAt`，Worker 只允許新指派目前的 Project members。
- `47f604f` 已執行完整 `pnpm mobile:sync`；iOS/Android bundle 均包含多人指派 UI，
  Android debug APK 與未簽章 iOS simulator build 成功。詳細差距與下一批工作見
  [Mobile 進度報告](./docs/reports/mobile-progress-2026-07-30.md)。
- `feature/multi-project-v1` 的 staging 候選基準是 `de24a29`。隔離的 staging
  Worker、D1、private R2、migration、owner、personal token 與驗證 Project/Boards
  已建立，authenticated smoke 與 R2 scope round-trip 已通過。private beta v3 已從
  `d43eb3f` 發布；下一步是以瀏覽器人工驗證首次連線，再進行 P0-4 多角色、雙裝置與
  實機驗收。

## P0-1：發布 Web private beta（已完成）

Sites beta v3 已從 `d43eb3f` 發布，保留 owner-only custom access。驗證結果：

- [x] `/`、`/privacy`、`/support` 都回 200。
- [x] `/app-config.json` 回 200，提供目前客製 title `定恆人工智能`。
- [x] 發布後 10 分鐘內 Sites Worker error log 無事件。
- [x] personal token 首次連線不再依賴 legacy `/board`。
- [ ] 由瀏覽器人工確認：輸入 staging URL 與 personal token 後，重新載入並進入
  「我的專案」。
- [ ] 由瀏覽器人工確認主標題與分頁 title 使用 JSON 值。
- [ ] 人工確認線上重新整理、離線 fallback 與 PWA service worker 升級。

限制：iOS/Android 會把 JSON 包入 App，修改後仍需 `pnpm mobile:sync` 與新 build。
手機桌面圖示下方的 App 名稱是原生 metadata，不能只靠 App 重啟變更。若未來要求已安裝
App 在不更新版本的情況下取得新 title，需要另外設計公開且可驗證的遠端設定端點。

## P0-2：依計畫實作多專案／多看板 v1

規格與實作計畫：

- [多專案／多看板管理 v1 規格](./docs/superpowers/specs/2026-07-24-multi-project-multi-board-design.md)
- [多專案／多看板 v1 實作計畫](./docs/superpowers/plans/2026-07-24-multi-project-multi-board-v1.md)

依計畫的 14 個 Task 實作：

1. Workspace → Project → Board domain types、local index、active context 與舊資料 migration。
2. D1 workspace、user accounts、access tokens、projects、memberships、boards、activity logs。
3. 個人 Bearer token、Project roles 與 Worker server-side authorization。
4. `/me`、Project、members、Board content、archive/restore API v2。
5. 「我的專案」、Project overview、Board switcher 與 role-aware UI。
6. per-board revision、sync debounce、queue v2 與 board-scoped R2 attachment key。
7. Project summary、server-side diff ActivityLog 與 archived read-only UI。
8. legacy `/board` alias、single-board D1/local migration 與 shared token 換發。

完成條件：

- 一位 user 可在不同 Project 擁有不同角色。
- 未參與 Project 無法列出、讀取或猜測內容。
- Project/Board 名稱彼此獨立，一個 Project 可有多個 Board。
- summary 只聚合目前 Project，沒有跨 Project dashboard。
- 封存後內容、附件與 Log 可讀但不可修改。
- 舊單一 Board、月報、附件 refs、墓碑與 revision 無資料遺失。
- 單元、Worker runtime、Web/mobile build 與 local migration tests 全綠。

在本節完成前，**不要建立 staging 遠端資源**。

### v1.1：任務多人指派

- [規格](./docs/superpowers/specs/2026-07-30-multi-assignee-tasks-design.md)
- [實作計畫](./docs/superpowers/plans/2026-07-30-multi-assignee-tasks-v1.md)

已完成 Card schema v5、Project member 多選、多人名稱顯示、離開成員保留、
Worker membership validation 與 Activity Log changed fields。待部署 staging Worker 與
private beta 後進行三角色、雙裝置人工驗收。

## P0-3：建立完全隔離的 staging（已完成）

正式資源不得拿來測試 3b。建立以下獨立資源：

| 類型 | staging 名稱 | production 名稱 |
| --- | --- | --- |
| Worker | `kanban-sync-staging` | `kanban-sync` |
| D1 | `kanban-sync-staging` | `kanban-sync` |
| R2 | `kanban-attachments-staging` | `kanban-attachments` |
| Token | staging 專用 | production 專用 |

已完成：

1. [x] 建立 `kanban-sync-staging` D1。
2. [x] 將實際 `database_id` 固定寫回 `worker-sync/wrangler.jsonc` 的 staging binding。
3. [x] 建立 private `kanban-attachments-staging` R2，未設定公開網域。
4. [x] 執行 `pnpm sync:migrate:staging`，`0001`、`0002` 均已套用。
5. [x] 產生只供 staging 使用的高熵 personal token：
   - D1 只儲存 SHA-256 hash。
   - 明文不得進 repo、shell history、CI log、測試快照或前端 bundle。
6. [x] 執行 `pnpm sync:deploy:staging`。
7. [x] 以安全注入的環境變數執行只讀 authenticated smoke test：

   ```bash
   KANBAN_SYNC_URL="https://<staging-worker>" \
   KANBAN_SYNC_TOKEN="<staging-token>" \
   pnpm sync:smoke
   ```

8. [x] 記錄 staging URL、資源 ID、token 建立日期與撤銷方式，但不記錄 token 明文。

非敏感 inventory：

| 類型 | 值 |
| --- | --- |
| Worker URL | `https://kanban-sync-staging.clerk-wong.workers.dev` |
| Worker deployment | `2280664a-b7cc-4511-9096-d65a37f1096e` |
| D1 | `kanban-sync-staging` / `bcae6724-352b-453d-92e4-28bcf229f76f` |
| R2 | private `kanban-attachments-staging` |
| Owner | `a14c7f5d-4c2e-8896-07652625d722` / `Staging Owner` |
| Token | personal `owner-web`，建立日期 2026-07-27；明文只存本機 Keychain |

驗收證據：

- 無 token 與錯 token 都回 401；owner personal token 對 `/me` 回 200。
- `/me` 回傳一個 owner Workspace；fresh staging 起初可合法回傳空 Project list，P0-4
  隨後建立一個驗證 Project 與兩個 Board。
- smoke script 已改以 multi-project `/me`、`/projects` 與可選的第一個 Board 做只讀
  驗證，不再把 fresh cutover 後不存在的 legacy `/board` 當成錯誤。
- migration state 為 `complete`；D1 token inventory 只查非敏感 metadata。
- production Worker、D1 與 R2 均未變更。

完成條件：

- [x] staging Worker、token、D1 與 R2 和 production 完全隔離。
- [x] staging 失敗或清除資料不影響既有 production 3a。
- [x] 未帶 token、錯 token 與有效 token 分別得到預期結果。
- [x] 維運命令與 Worker response 未輸出 Bearer token、token hash 或附件內容。

## P0-4：staging Release Candidate 驗收

至少使用兩個獨立瀏覽器 profile，並加入一台 iOS 或 Android 實機。所有項目通過前，
不得建立 production R2 或部署 production 3b。

### 自動化

- [x] `de24a29` fresh clone 在 final mobile sync 後工作樹乾淨，`git diff --check` 通過。
- [x] `pnpm install --frozen-lockfile` 可從 fresh clone 完成。
- [x] `pnpm test`（153）、`pnpm worker:test`（48）、lint、typecheck 全綠。
- [x] Web build、mobile build、generated Worker types check 全綠。
- [x] production/staging Worker dry-run 全綠，bindings 分別指向各自 D1/R2。
- [x] Android debug 與未簽章 iOS simulator build 全綠。
- [x] 362 個 tracked、Wrangler log 與 Web/mobile/native build artifact files 中，實際
  staging token 與 SHA-256 hash 都是 0 命中。

### Staging API 基線

- Project：`449390b4-b03a-4e60-8873-991eece77f37` / `Staging 驗證專案`，owner 是
  manager。
- Board A：`655c1c1c-e54d-4006-9670-84959b26b58d` / `Web 驗證看板`，revision 1。
- Board B：`20a59286-a61f-4cbf-a6dc-d14a0d4a0222` / `App 驗證看板`，revision 0。
- 相同 attachment ID 在 A/B 寫入不同 bytes 後可各自讀回，證明 Board-scoped R2
  隔離；測試物件已刪除，bucket 回到 0 objects / 0 B。
- 建立資料後 authenticated smoke 通過：1 Workspace、1 Project、抽驗 1 Board。

完整命令：

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
git diff --check
```

### 多專案與權限

- [ ] 「我的專案」只顯示呼叫者參與的 Project。
- [ ] 同一 user 可在 Project A 為 manager、Project B 為 viewer。
- [ ] workspace admin 未加入 Project 時只能看管理 metadata，不能讀工作內容。
- [ ] contributor 可改 Card，但不能管理成員或封存 Board。
- [ ] viewer 可讀 Board、Attachment、summary 與 Log，但不能 mutation。
- [ ] manager/contributor 可指派多位 Project members；viewer 只能查看負責人。
- [ ] 非 Project member 不能被新指派；成員離開後既有指派保留且可移除。
- [ ] 多人任務移到完成欄時仍只有一個 Card-level `completedAt`。
- [ ] Project 與 Board 名稱可不同，改名互不影響。
- [ ] 同一 Project 的多個 Board revision、離線 cache 與 queue 彼此隔離。
- [ ] Project summary 不混入其他 Project，預設排除 archived Board。
- [ ] 封存後唯讀、可看 Log，還原後 revision 與資料不重置。

### 3a 看板同步

- [ ] 首台裝置可選擇合併或採用遠端 legacy Board。
- [ ] 第二台裝置最終收斂到同一看板。
- [ ] 新增、編輯、移動、完成、重開與刪除均可收斂。
- [ ] 離線修改後重啟，恢復連線或回前景會自動同步。
- [ ] 409 合併與 adopt-remote 分支不遺失較新的卡片。
- [ ] 錯 token 顯示可理解訊息，本機資料不受影響。

### 3b 附件同步

- [ ] A 裝置新增照片或錄音，B 裝置可下載、顯示與播放。
- [x] Attachment endpoint 與 R2 key 都包含正確 Project/Board scope；同 attachment ID
  的 A/B round-trip 不互相覆寫。
- [ ] 無 membership 的 user 即使知道 attachment ID 仍無法下載。
- [ ] 遠端 board 不會先發布尚未成功上傳的附件參照。
- [ ] B 裝置先看到參照時，下載失敗可重試，不會永久卡住。
- [ ] 離線新增後重啟 App，恢復連線或回前景會補傳。
- [ ] 單附件移除、刪卡與重設看板最終清除 R2。
- [ ] 取消草稿不留下本機或 R2 orphan。
- [ ] 10 MiB 邊界、空 body、異常 key 與 404/413 行為符合預期。
- [ ] 切換同步 URL/token 不會把舊 queue 送到新環境。
- [ ] upload/download/delete 重試冪等，不重複也不漏失。

### 月報

- [ ] 完成月份以 `completedAt` 計算。
- [ ] 完成後修改標題、附件或 checklist 不會改變原完成月份。
- [ ] 移出再移回完成欄符合目前定義。
- [ ] 最近六個日曆月包含零資料月份。
- [ ] UTC 月界線在 Asia/Taipei 顯示正確。
- [ ] v1/v2/v3 舊資料 migration 結果可接受。

### Web/PWA 與客製設定

- [x] private beta v3 仍是 owner-only custom access。
- [ ] JSON title、metadata、分享預覽與頁面主標題一致。
- [ ] HTTPS 安裝、離線冷啟動及 service worker 升級正常。
- [ ] 新版設定線上立即取得，離線仍有可用 fallback。
- [ ] 瀏覽器附件與麥克風權限拒絕／恢復流程正常。
- [x] 線上 `/privacy` 與 `/support` 回 200。

### iOS / Android 實機

- [x] `47f604f` 執行過完整 `pnpm mobile:sync`，四個 Capacitor plugins 均同步。
- [x] Android `:app:assembleDebug` 成功並產出 debug APK。
- [x] iOS `.xcworkspace` generic simulator 未簽章 build 成功。
- [x] `1.1.0` 安裝並啟動於 iPhone 17 Pro / iOS 26.5 Simulator；確認原生 launch、
  本機 Board 首畫面與 Mobile「說明」入口呈現，並補上 React 載入前靜態畫面。
- [x] iOS/Android native bundle 都包含多人指派介面。
- [x] 以 `assets/` Kanban 品牌來源取代 Capacitor 預設 icon/splash，並加入
  `pnpm mobile:assets` 可重現產生流程。
- [x] 內測更新設為 iOS `1.1.0 (3)`、Android `1.1.0 (versionCode 3)`；包含可客製化工作流欄位名稱的最新 Mobile bundle。
- [x] build 3 已通過 Android debug APK、iOS simulator 與 Apple Development 簽署的 iOS device build。
- [x] build 3 已覆蓋安裝並啟動於 iPhone 12 Pro Max；裝置回報版本 `1.1.0 (3)`。
- [x] build 3 已覆蓋安裝並啟動於 Pixel 9a；裝置回報 Android `versionName 1.1.0`、`versionCode 3`。
- [ ] 在 iPhone 與 Pixel 9a 驗證登入憑證保留、欄位改名與任務移動。
- [x] Project Owner 工作流管理已支援新增欄位、設定 WIP、左右排序與刪除空欄；完成欄與非空欄位不可刪除，member 仍只能編輯／移動任務。
- [x] 欄位管理已加入 Worker 權限與安全轉換驗證，以及 created／renamed／WIP／moved／deleted audit diff；183 個 Web 測試與 56 個 Worker 測試通過。
- [x] build 4 已通過 Mobile sync、Android debug、iOS simulator 與 Apple Development 簽署的 iOS device build；產物位於 `outputs/mobile/`。
- [ ] 將 build 4 覆蓋安裝至 iPhone 12 Pro Max 與 Pixel 9a，驗證欄位管理及既有登入資料保留。
- [x] 補 Mobile bundle 內可離線讀取的支援／隱私面板，內容與 Web 共用。
- [x] Android debug APK 已由 debug keystore 簽署，可供受控內部測試。
- [x] 本機已有有效 Apple Development／Distribution identity；iOS Release device
  build 與本機 `.xcarchive` 成功，archive 目前以 Apple Development + team
  provisioning profile 簽署，尚未做 distribution export／上傳。
- [ ] 提供 Android release keystore 與 CI secret，再產生 release-signed AAB／APK。
- [x] Android release signing 已改由四個 `KANBAN_ANDROID_*` 環境變數注入；缺少任一
  secret 時 release task 會立即停止，keystore 類型亦加入 `.gitignore`。
- [ ] 產生 TestFlight 或 internal track build。
- [x] personal token 改用 iOS Keychain 與 Android Keystore-backed AES-GCM storage；
  原生 App 啟動時會一次性遷移 WebView localStorage，只有安全寫入成功才刪除舊 token。
- [x] 安全儲存改為非同步平台能力；首次登入、legacy token 換發、停用同步、附件下載
  重試與 Project/Board bootstrap 均使用同一安全儲存來源。
- [x] 新增安全遷移／失敗保留／清除測試；`pnpm mobile:sync`、Android debug build、
  iOS simulator build、Simulator 安裝啟動與 iOS signed Release archive 均成功。
- [ ] 相機、相簿、錄音、播放與繁中語音建卡正常。
- [ ] 權限拒絕後不崩潰，重新授權可恢復。
- [ ] 背景／前景、斷網、重啟與低儲存空間不遺失 board。
- [ ] App 內 title 使用候選 JSON 值。
- [ ] Web ↔ Mobile 多人指派、Board revision 與附件最終收斂。

## P0-5：production cutover

### 前置條件

- staging 上述清單全部通過並記錄證據。
- multi-project migration、legacy alias、個人 token 與角色授權均已通過 staging。
- 決定既有 beta Sites project 是否沿用並綁正式 custom domain；不要臨時覆寫
  `.openai/hosting.json` 的 project 關聯。
- 準備 production token 發放與撤銷名單。
- 決定行動版版本號、build number、簽章與回退版本。

### 嚴格發布順序

1. 記錄目前 production Worker deployment/version。
2. 取得 production D1 Time Travel bookmark，另存完整 D1 export。
3. 確認 production migration 狀態與預期一致。
4. 建立 private `kanban-attachments` production R2。
5. 部署 production Worker。
6. 先驗證既有 3a `/board` GET、PUT、401 與 409 行為。
7. 再驗證 3b attachment PUT、GET、DELETE、404、413 與錯誤 envelope。
8. 儲存並發布 private production Web/PWA version。
9. 驗證 Web/PWA、分享 metadata、客製 title、離線啟動與 service worker 升級。
10. 在相同 release commit 上執行 final mobile sync、簽章與實機 smoke test。
11. 逐步發放，持續觀察 Worker errors、D1/R2 用量及同步失敗率。

### Rollback 原則

- Worker rollback 只回退程式與 bindings，不會還原 D1/R2 狀態。
- migration 必須採向前、向後相容方式；資料修復與程式 rollback 分開處理。
- D1 restore 是覆寫資料庫的事故操作，執行前必須保存當下 bookmark。
- R2 已寫入或刪除的物件不會隨 Worker rollback 自動還原。
- 保留上一個穩定 Worker version、Sites version 與行動版安裝包。

### 立即停止條件

任一步出現以下情況，就停止後續發布：

- 3a board GET/PUT/409 行為改變。
- migration 狀態與預期不同。
- R2 upload/download/delete 任一不一致。
- 雙裝置 board 或附件無法最終收斂。
- logs 出現 token、附件內容或大量未處理例外。
- Web/PWA 新版無法在線或離線啟動。
- title 設定造成空白頁、快取循環或原生 App 啟動失敗。

## P1：維運與後續改善

這些工作不阻擋 staging，但應在正式擴大使用前完成：

- 撰寫 token 新增、撤銷、輪替、裝置遺失與成員離開 runbook。
- 撰寫 D1 bookmark/export/restore、Worker rollback 與事故通報 runbook。
- 定義 staging 定期重設流程，同步清除 D1 board 與 R2 objects，避免失效參照。
- 建立 R2 orphan 掃描與保守清理流程。
- 對 Worker 5xx、同步失敗率、D1/R2 用量建立監控與告警。
- 評估 token rate limit；保留 CORS `*` 時記錄其理由與風險。
- 在獨立 PR 更新 Wrangler、Workers types 與 compatibility date；不要和 production
  cutover 放在同一個不可拆部署。
- 若需要已安裝 App 即時更新 title，設計具完整性驗證、cache fallback 與版本欄位的
  遠端設定服務。

## 行動版發行工作

### 內部測試版

1. 在 release commit 執行 final `pnpm mobile:sync`。
2. 確認沒有非預期變更 Xcode signing/team 或 Android signing 設定。
3. iOS 使用 `.xcworkspace` 建置並在實機測試。
4. Android 產出最新 debug APK 或內部 release build。
5. 驗證安裝升級與上一版回退。

### App Store / Google Play

仍需：

- 已註冊且固定的 bundle/application ID。
- iOS distribution certificate/profile、Archive、版本號與 build number。
- Android release keystore/signing config、AAB、`versionCode` 與 `versionName`。
- Privacy Policy、支援 URL、商店文案、截圖、分類與年齡分級。
- App Privacy / Google Play Data Safety 揭露：相機、相簿、麥克風、語音辨識、
  裝置檔案、Bearer token、D1 看板資料與 R2 附件。
- 存取撤銷與雲端資料刪除政策。

## 已知限制

- 刪除墓碑只保留 30 天；離線更久的裝置可能讓舊卡片復活。
- 共用 token 不是個人帳號權限模型；成員離開或裝置遺失需人工撤銷換發。
- 附件 queue 保證跨重啟保存，並在 App 啟動、上線、回前景、資料變更或手動同步時
  重試；它不是 iOS/Android 的永久背景傳輸程序。
- JSON title 可在 Web 啟動時重新讀取；原生已安裝 App 的 bundled JSON 與桌面名稱
  仍受 App build 限制。
- 本機自動化通過不能取代 staging 雙裝置、實機與 production smoke test。

## 建議時程

| 階段 | 估計 |
| --- | --- |
| title 提交與 private beta v2 | 0.5 天 |
| 多專案 domain、ACL、API、UI、migration 與測試 | 4–7 天 |
| staging 資源建立與初始部署 | 0.5–1 天 |
| 多角色、雙裝置、Web/PWA 與實機驗收 | 2–3 天 |
| production 備份、cutover 與觀察 | 1 天 |
| 商店資料、簽章與審核 | 另案估算 |

## 官方參考

- Cloudflare Workers 設定：<https://developers.cloudflare.com/workers/wrangler/configuration/>
- Workers environments：<https://developers.cloudflare.com/workers/wrangler/environments/>
- D1 migrations：<https://developers.cloudflare.com/d1/reference/migrations/>
- D1 Time Travel：<https://developers.cloudflare.com/d1/reference/time-travel/>
- R2 Workers API：<https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- Workers rollback：<https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
