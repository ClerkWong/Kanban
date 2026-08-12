# 定恆人工智能

離線優先的繁體中文 Kanban。Web/PWA 與 Capacitor iOS、Android 共用同一套
React 看板介面；資料先寫入裝置，使用者可選擇連接 Cloudflare Worker，將看板存入
D1、附件存入 R2，供多裝置共用。

目前正式環境只上線既有的看板同步（3a）。新版月報、附件同步（3b）與 Web/PWA 已完成
本機整合；Web private Beta 託管於 Cloudflare Workers
（<https://kanban-beta.wongchamber.com>，Cloudflare Access 保護，
以 `pnpm web:deploy:beta` 發布）。仍須先完成雙裝置與實機驗收，
才可切換正式資源。完整狀態、順序與停止條件見 [NextTasks.md](./NextTasks.md)。

## 功能

- 看板新增、編輯、拖放、鍵盤移動、搜尋、篩選、WIP 與逾期統計。
- 本機儲存與離線啟動；同步失敗不影響本機編輯。
- 最近六個日曆月的完成報表，以卡片 `completedAt` 計算。
- 多個 Project／Board、每個 Project 獨立角色、封存唯讀與 Activity Log。
- Web 附件使用 IndexedDB；iOS/Android 使用 Capacitor Filesystem。
- 照片、錄音與原生繁中語音建卡。
- 選用的 D1 看板同步與 R2 附件同步；Bearer token 只由使用者在裝置端輸入。
- PWA manifest、service worker、隱私與支援頁。
- 卡片欄位停留老化、Cycle Time／阻塞時長／流動效率流動報表、服務類別與加急 WIP 上限。
- 管理者專屬的跨專案日曆檢視：依截止日呈現本月任務、未排程池與每人件數（桌面專用）。

## 架構

```text
app/
  components/board/   共用看板 UI
  components/projects/ Project／Board 導覽、管理與 legacy migration UI
  platform/           Web / Capacitor 裝置能力
  sync/               看板與附件同步用戶端
mobile/               純 Vite 的 Capacitor Web bundle 入口
ios/ android/         原生殼
worker-sync/          Cloudflare Worker、D1 migration、R2 API 與 runtime tests
```

Web 入口由 vinext 建置；行動版以 Vite 將同一套元件輸出至 `dist/mobile`，再由
Capacitor 同步到原生專案。同步 Worker 是獨立服務，不依賴網站登入 cookie。

## 開發環境

- Node.js `>=22.13.0`
- pnpm `11.11.0`（以 `packageManager` 欄位為準）
- 建置原生 app 時另需 Xcode/CocoaPods 或 Android Studio/JDK 21

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Web 分享 metadata 預設使用目前 request 的 HTTPS origin；也可用
`NEXT_PUBLIC_SITE_URL` 明確覆寫。若設定此值，staging 與 production 必須使用各自的
網站 origin，避免分享圖連到錯誤環境。

## 客製標題

畫面主標題與瀏覽器／App WebView 的分頁標題由
[`public/app-config.json`](./public/app-config.json) 提供：

```json
{
  "title": "團隊工作看板"
}
```

啟動時會以 `no-store` 重新讀取設定；空白、非字串或超過 80 個字元時會退回預設標題。
本機 Web 修改後重新整理即可看到結果。已部署的 Web 需要重新發布 JSON；iOS/Android
會將 JSON 包入 App，因此修改後必須重跑 `pnpm mobile:sync` 並安裝新 build。手機桌面
圖示下方的 App 名稱屬於原生系統 metadata，不能由 JSON 在執行期間變更。

## 品質檢查

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

GitHub Actions 另會建置 Android debug app 與未簽章的 iOS simulator app。Worker runtime
tests 使用 Cloudflare Vitest integration，在本機 D1/R2 模擬環境驗證認證、衝突、
附件限制與錯誤回應。

## 行動版

```bash
pnpm mobile:assets
pnpm mobile:sync
pnpm mobile:ios
```

`mobile:assets` 會從 `assets/` 的 SVG 品牌來源重新產生 iOS/Android icon 與 splash；
只有品牌來源變更時才需執行。

CI 或只建單一平台時使用 `pnpm mobile:sync:android` / `pnpm mobile:sync:ios`，避免在
不具備另一平台工具鏈的 runner 上執行不必要的同步。

Android 可在同步後由 Android Studio 開啟，或執行：

```bash
cd android
./gradlew :app:assembleDebug
```

`mobile:sync` 會先重建 `dist/mobile`，再更新 iOS/Android 原生資產。發布候選版必須在
同一 commit 上重跑此命令，不能沿用舊 bundle。

## 同步 Worker

Wrangler 設定在 `worker-sync/wrangler.jsonc`：

- 預設環境是現有 production Worker/D1 與尚未建立的 production R2 binding。
- `env.staging` 使用獨立 Worker、D1 與 R2 名稱。
- named environment 的 bindings 已完整重述，不依賴 production 繼承。

本機啟動：

```bash
pnpm sync:migrate:local
pnpm sync:dev
```

多專案 schema 套用後，以固定的 owner UUID 初始化本機 Workspace。Token 只可從不回顯的
互動提示或 stdin 傳入，腳本不接受 `--token`；請勿用會把明文留在 shell history 的
命令組合：

```bash
pnpm sync:bootstrap \
  --target local \
  --user-id "11111111-2222-4333-8444-555555555555" \
  --display-name "本機管理員" \
  --workspace-name "開發 Workspace" \
  --token-label "本機測試裝置"
```

重跑時使用相同 `--user-id`。`staging` 與 `production` target 會使用 remote D1；
production 另須明確加入 `--confirm-production`。在 Task 1–13 本機驗收完成前，不得執行
任何 remote target。腳本只顯示 target 與 resource IDs，不顯示 token 或 token hash。

### Legacy 單看板切換

舊 `board` row 的切換必須在 bootstrap 完成後由明確命令執行。命令會先把
`migration_state` 設為 `locked`，使舊 `/board` PUT 收到可重試的 503；接著才從最新
legacy row 複製 revision 與完整 Board JSON，建立預設 Project／Board 與 memberships，
最後標記 `complete`。複製失敗會把狀態回復為 `pending`：

```bash
pnpm sync:migrate:legacy \
  --target local \
  --manager-user-id "11111111-2222-4333-8444-555555555555"
```

Staging 改用 `--target staging`；production 還必須加入 `--confirm-production`。不得在
未備份、未確認 manager UUID 或 client 仍大量使用舊版時執行 production cutover。

切換前後可將 `/board` 與 v2 Board API 的 JSON response 各保存為權限受控的暫存檔，
再執行：

```bash
pnpm sync:verify:migration \
  --legacy-file /path/to/legacy-snapshot.json \
  --v2-file /path/to/v2-snapshot.json
```

驗證輸出只包含 revision、card/completed/attachment/tombstone 數量與 `completedAt`
清單，不輸出卡片描述或 token。Snapshot 與 client 匯出的
`kanban-legacy-backup.json` 仍可能含工作內容，驗證後應依資料政策安全刪除。

新版 client 偵測到 local placeholder 與 server legacy Board 時，會要求明確選擇
「合併本機與遠端」或「採用遠端」。合併沿用 card-level LWW 與 tombstone 規則，
不做整份覆蓋；原本機 Board 只備份一次。若 `/me` 回報目前使用 shared legacy token，
client 會要求輸入個人 token。Worker 會先驗證個人 token 有效，成功後才撤銷舊 token；
驗證失敗時原 token 保持有效。

所有遠端 migration、資源建立與部署都屬外部變更。先依
[NextTasks.md](./NextTasks.md) 建立 staging 並通過驗收；不要直接用 production
測試附件流程。部署後可用只讀 smoke test：

```bash
KANBAN_SYNC_URL="https://staging-worker.example.workers.dev" \
KANBAN_SYNC_TOKEN="<staging-token>" \
pnpm sync:smoke
```

腳本不接受命令列 token，也不會修改遠端看板。CI、repo、bundle 與 log 都不得包含
明文 token。

Staging 資源建立、角色驗證與協調重設請依
[multi-project staging runbook](./docs/runbooks/multi-project-staging.md)；個人 token
的建立、列示、輪替、撤銷與裝置遺失處理請依
[token lifecycle runbook](./docs/runbooks/token-lifecycle.md)。`pnpm sync:token` 的
create 只從隱藏提示或 stdin 讀取明文，list 不查詢 token hash，production 操作必須
加上 `--confirm-production`。

## Project／Board 與同步行為

- 「我的專案」只列出目前 user 具有 membership 的 Project；沒有跨專案內容總覽。
- Manager 管理 Project、成員與 Board；Contributor 可修改卡片；Viewer 唯讀。
- 一個 Project 可有多個 Board；owner 指派每位 member 可見的 Board，member
  對未指派 Board 一律得到 404。
- 未設定指派的 member 預設只看主要 Board（最後更新的 active Board）。
- 每個 Board 使用獨立 revision、local cache、attachment queue 與 R2 scope。
- 同步以 revision 樂觀鎖與卡片級 `updatedAt` LWW 合併。
- 刪除墓碑保留 30 天；離線超過 30 天的舊裝置仍可能讓已刪卡片重新出現。
- 附件上限為 10 MiB。上傳必須先成功，board 才可發布附件參照；刪除則在 board
  不再引用後送出冪等 DELETE。
- 附件 queue 會跨重啟保留，並依同步服務 origin 隔離；不持久化 token。
- 同步服務網址必須使用 HTTPS，只有 localhost/loopback 開發環境可使用 HTTP。
- token 儲存在裝置本機，仍屬敏感憑證；裝置遺失、成員離開或疑似外洩時必須撤銷換發。
- 卡片阻塞累計時長（blockedMs）在多裝置併發編輯時取最後寫入者，可能少算一段阻塞時間；
  這是為了維持卡片級 LWW 合併簡單性所接受的精度損失。
- workspace owner／admin 可從平台管理的使用者管理指派任何專案的成員，包含把自己加入
  專案——這會取得該專案的工作內容讀取權，是刻意接受的權限升級路徑，以 Activity Log
  的 `via: "platform_admin"` 稽核而非技術阻擋。
- workspace owner／admin 可透過日曆端點讀取整個 workspace 所有 active 專案的卡片標題、
  截止日與指派人；放寬限定在該端點，board content、附件與 Activity Log 仍需加入專案才能讀。
- 上述兩項放寬疊加後，workspace admin 可以先用日曆看見某專案有哪些工作，再自我指派進入該
  專案讀取完整內容。日曆讀取本身不留稽核紀錄，自我指派會留 `via: "platform_admin"`；這是
  刻意接受的管理者能力範圍，而非技術阻擋。

## 相關文件

- [NextTasks.md](./NextTasks.md)：目前狀態、後續任務、驗收與 rollback runbook。
- [多專案／多看板 v1 規格](./docs/superpowers/specs/2026-07-24-multi-project-multi-board-design.md)
- [多專案／多看板 v1 實作計畫](./docs/superpowers/plans/2026-07-24-multi-project-multi-board-v1.md)
- [設計規格](./docs/superpowers/specs/2026-07-14-mobile-app-design.md)
- [3a 同步計畫](./docs/superpowers/plans/2026-07-20-cloud-sync-phase3a.md)
