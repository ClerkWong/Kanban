# Kanban 部署前工作與實作計畫

最後盤點：2026-07-23  
盤點基準：`main` / `889bba7`，包含目前尚未提交的工作目錄變更

## 本輪實作進度

原始盤點後已完成本機實作與自動化驗收：

- 月報改用 `completedAt`，schema v4 支援 v1/v2/v3 遷移，並修正同步合併時完成狀態與
  Done 欄位置可能分離的競態。
- 3b 用戶端已接通 upload/download/delete queue、跨重啟重試、先上傳後推 board、
  按需下載快取與 10 MiB 限制。
- Worker 已補 R2 輸入限制、metadata、request ID、結構化錯誤、create race 409、
  generated types 與 Workers runtime tests。
- 已加入 staging Wrangler environment、明確的 staging/production scripts、
  GitHub Actions、PWA metadata/service worker、隱私/支援頁、分享圖與部署文件。
- 本機驗收已通過：52 個單元測試、8 個 Worker runtime tests、lint、typecheck、
  Web/mobile build、production/staging Worker dry-run、final `mobile:sync`、Android
  debug build 與未簽章 iOS simulator build。

尚未執行的都是外部發布工作：staging 資源與 token、雙裝置/實機驗收、production
D1 備份與 R2 建立、Worker/Sites/行動版正式發布。這些閘門通過前仍不可部署 production。

## 結論

目前**已上線的 3a 看板同步服務可繼續使用**，本機候選版的程式與自動化閘門已補齊，
但**不應跳過 staging 與實機驗收直接部署成下一個正式版本**。

原始盤點發現的阻擋包括：

1. 工作目錄混有兩組尚未提交的功能：每月完成報表、3b 附件雲端同步。
2. 3b 只有 Worker API 與本機佇列骨架，尚未接入新增、刪除、下載、前景重試及同步流程。
3. `worker-sync/wrangler.jsonc` 宣告的 `kanban-attachments` R2 bucket 在正式 Cloudflare 帳號中不存在；直接部署目前 Worker 會帶入無效的正式綁定。
4. 每月報表以 `updatedAt` 當完成日期，但卡片移入完成欄時目前不會更新 `updatedAt`；報表數字不能代表實際完成月份。
5. Web/PWA 雖可成功 build，但 `.openai/hosting.json` 沒有 `project_id`，repo 內沒有可驗證的 Sites 正式站關聯。
6. iOS/Android 原生殼可建置，但當時工作目錄最新的 Web bundle 尚未執行 `pnpm mobile:sync` 寫入原生專案。

建議把下一版定義為：

> 完成並驗收「準確的月報 + 3b 附件同步」，先在獨立 staging 環境通過雙裝置測試，再依序發布 Worker、Web/PWA 與行動版。

以下章節保留原始差距、實作設計與發布 runbook；完成狀態以本節與
[NextTasks.md](./NextTasks.md) 為準。

## 原始盤點現況（實作前基準）

| 發布面 | 現況 | 判定 |
| --- | --- | --- |
| 同步 Worker 3a | `https://kanban-sync.clerk-wong.workers.dev` 可回應；未帶 token 的 `/board` 正確回 401 | 已部署 |
| 正式 D1 | `kanban-sync` 可存取，`wrangler d1 migrations list --remote` 顯示無待套用 migration | 可沿用 |
| 正式 R2 | `kanban-attachments` 查詢回覆「bucket does not exist」 | **阻擋 3b** |
| 目前正式 Worker 能力 | 回應的 CORS methods 仍為 `GET, PUT, OPTIONS`，表示附件 DELETE/3b 程式尚未上線 | 符合 3a 現況 |
| Web/PWA | `pnpm build` 成功；Sites 設定沒有 `project_id` | 尚未完成正式託管 |
| iOS | 不簽章的 simulator build 成功 | 原生殼可建置；仍需 final sync、簽章與實機驗收 |
| Android | debug APK build 成功 | 原生殼可建置；仍需 final sync、release 簽章與實機驗收 |
| 自動化 | 41 tests、lint、typecheck、Web build、mobile build 全部通過 | 基礎品質良好 |
| CI/CD | repo 內沒有 GitHub Actions 或其他部署 pipeline | 發布仍是人工流程 |
| Git 狀態 | 6 個已追蹤檔案有修改；除本文件外另有 4 個新功能檔未追蹤；`git diff --check` 有尾端空白 | **不可直接發版** |

補充：原生 build 使用的 `ios/App/App/public` 與 `android/app/src/main/assets/public` 是先前同步且被 gitignore 的產物；它們不等於本次 `dist/mobile` 的最新內容。

## P0：發布前阻擋項

### 1. 先凍結發布範圍並整理 Git

建議拆成三個可審查的變更：

1. `monthly-report`：完成日期模型、月報 UI 與測試。
2. `attachment-sync-3b`：Worker、R2、本機儲存、佇列、下載快取與測試。
3. `deployment-readiness`：staging/production 設定、CI、文件、PWA metadata 與發布 runbook。

完成條件：

- 工作目錄只含本次發布內容。
- 新檔全部納入版本控制。
- `git diff --check` 無錯誤。
- PR 或 commit 可分別回滾，不把報表、3b 與部署設定混成單一不可拆版本。

### 2. 修正「完成月份」資料模型

目前 `getMonthlyCompletionStats()` 使用 `card.updatedAt`；但 `moveCard()` 只更新欄位順序與 `lastSavedAt`，沒有記錄卡片何時進入完成欄。之後在完成卡上改標題或附件，也會把報表月份錯移到編輯月份。

實作：

1. 在 `Card` 增加 `completedAt: string | null`，並提升 `BOARD_SCHEMA_VERSION`。
2. 卡片第一次或再次移入 `done` 時寫入 `completedAt`，移出完成欄時清除，並同步更新 `updatedAt`。
3. 定義舊資料遷移：
   - 已在完成欄的舊卡片，可用舊 `updatedAt` 做一次性推定，並在 UI/文件註明歷史資料為估算；或
   - 對舊卡設 `completedAt = null`，報表只從新版本開始精準統計。
4. 月報改用 `completedAt` 分組，不直接修改原始 board/card。
5. 決定圖表語意是「最近 6 個日曆月（含 0）」或「最近 6 個有資料的月份」。建議前者。
6. 補回被目前 diff 移除的 `getBoardStats().completed` 斷言。

驗收：

- 移入完成欄後出現在正確月份。
- 完成卡之後編輯標題、附件或 checklist，不改變完成月份。
- 移出再移回時，行為符合已定義規則。
- 舊版 v1/v2/v3 資料可安全遷移。
- 衝突合併後，`completedAt` 與欄位位置能收斂。

若這一輪不打算處理資料模型，應先移除目前未提交的月報入口，不要發布不準確的報表。

### 3. 完成 3b 用戶端整合

目前 `attachment-api.ts` 與 `attachment-queue.ts` 沒有被應用程式引用，因此測試與 build 通過不代表附件同步可用。

需要完成：

1. **平台儲存介面**
   - 增加「檔案是否存在」與「以指定 `fileName` 寫入 Blob/bytes」能力。
   - Web 存入 IndexedDB；Capacitor 存入 Filesystem。
   - 遠端下載必須保留 board 內的原始 `fileName`，不能重新產生不同檔名。

2. **上傳生命週期**
   - 新增附件後 enqueue upload。
   - 先確認 R2 upload 成功，再讓遠端 board 參照該附件，避免其他裝置先看到 404。
   - 同步首次啟用時只 enqueue 確實存在於本機的附件，不把「別台裝置建立、此機尚未下載」的附件誤判為待上傳。

3. **下載與快取**
   - 合併遠端 board 後找出本機缺少的附件。
   - 按需或背景下載並落地快取。
   - `AttachmentItem` 本機讀取失敗時可觸發一次遠端下載與重試，並顯示明確的離線/404 狀態。

4. **刪除順序**
   - 先把附件參照從遠端 board 移除並成功同步，再刪 R2 object。
   - 若 upload 尚未完成就刪除附件，以同一個冪等 DELETE 取代 upload；即使 upload
     已送達 R2、但 app 在 queue 落盤前中斷，也能最終清除 orphan。
   - 刪卡、重設看板與附件單獨移除都要走相同的 queue 規則。

5. **持久化重試**
   - 驗證 localStorage queue 的資料形狀，不直接 cast 任意 JSON。
   - queue item 必須綁定同步 endpoint/board 身分；切換 Worker URL 或 token 時不得把舊 queue 送到新伺服器。
   - 監聽 `online`、App 回前景、手動同步與下一個 retry deadline。
   - 區分「本機檔案不存在」、「401」、「413」、「404」與暫時性網路錯誤。
   - 不可像目前程式一樣把所有非 `AttachmentApiError` 的 upload 失敗靜默永久丟棄。

6. **容量與狀態**
   - UI 擷取後立即檢查 10 MB 上限並提示使用者。
   - 同步 pill 或附件列顯示等待上傳、失敗、已同步、下載中等狀態。
   - 明確定義 App 進背景後的保證：目前設計是「跨重啟保留、回前景重試」，不等於 iOS/Android 真正 background transfer。

### 4. 建立 staging，避免直接用正式共用看板測試

目前 `worker-sync/wrangler.jsonc` 只有 production，且 D1/R2 綁定直接指向正式名稱。

實作：

1. 建立獨立的 staging Worker、D1、R2 與測試 token。
2. 在 Wrangler 設定增加 `env.staging`；D1/R2 bindings 在 named environment 不會自動繼承，必須完整重寫。
3. 加上 `$schema` 指向本機 Wrangler schema。
4. 增加明確 scripts，例如：
   - `sync:dev`
   - `sync:migrate:staging`
   - `sync:deploy:staging`
   - `sync:deploy:prod`
5. production mutation command 不應是最短、最容易誤按的預設命令。

驗收：

- staging 的 board、token、R2 objects 與 production 完全隔離。
- 兩台裝置可只靠 staging URL 完成 3a/3b 全流程。
- staging 驗收失敗時不影響目前已上線的 3a Worker。

### 5. 建立 R2 並強化 Worker

在 staging 驗收通過前，不建立或綁定正式 R2。

Worker 必做：

1. 建立 staging bucket；production cutover 前再建立 `kanban-attachments`。
2. 不要只信任 `Content-Length`：
   - header 缺失或偽造時，現在的 10 MB 限制可被繞過。
   - 實作真正的 bounded upload，超過上限回 413。
3. 驗證 attachment key 格式與長度；拒絕空值、異常編碼及未允許的型別。
4. GET 回應加入適合的 `Content-Length`、`ETag`、`X-Content-Type-Options: nosniff` 與 cache 策略。
5. 所有 D1/R2 例外回傳一致 JSON、CORS 與 request id；不要讓未處理例外變成無法診斷的 1101。
6. 修正兩個並發 `baseRevision = 0` create 造成第二個 request 500 的 race，收斂為 409。
7. 產生 Wrangler binding types，移除手寫的 `worker-sync/src/d1.ts`、`r2.ts` 與 `interface Env`：
   - 執行 `wrangler types`
   - default export 使用 `satisfies ExportedHandler<Env>`
8. 設定 observability sampling，記錄結構化錯誤；不得記錄 Bearer token。
9. 評估 token rate limit、撤銷與輪替流程。CORS `*` 若為了 Web + Capacitor 保留，需記錄這是刻意決策。
10. 定義 orphan object 清理策略，避免取消新增、衝突或異常中斷留下永久 R2 垃圾。

Worker 測試至少涵蓋：

- OPTIONS/CORS。
- 無 token、錯 token、有效 token。
- board GET/PUT/409、並發首次建立。
- attachment PUT/GET/DELETE/404。
- 無 `Content-Length`、超過 10 MB、空 body、異常 key、型別不符。
- D1/R2 例外仍回一致 JSON。

建議改用 `@cloudflare/vitest-pool-workers` 在 Workers runtime 搭配本機 D1/R2 binding 測試，而不是只測 `logic.ts`。

### 6. 完成 Web/PWA 正式站設定

1. 透過 Sites 建立或連結正式 project，讓 `.openai/hosting.json` 保存 `project_id`。
2. 本專案的 D1/R2 由獨立 `worker-sync` 擁有，因此 Web 站的 `.openai/hosting.json` 可繼續讓 `d1`、`r2` 為 `null`；不要把兩套資源誤綁在一起。
3. 先採 private deployment，確認存取政策後再決定是否公開。
4. 更新已過時文案：
   - `README.md` 仍是 `vinext-starter`。
   - manifest、metadata 與頁首仍宣稱資料「只存在本機」，和已提供雲端同步矛盾。
   - README 指令混用 `npm`，應統一為 repo 宣告的 `pnpm@11.11.0`。
5. 增加正式站 title/description、Open Graph/X preview 與支援/隱私連結。
6. 修正 service worker：
   - cache version 與發布版本連動。
   - `cache.put()` 要納入 event lifetime，避免 floating promise。
   - 只快取成功回應，驗證新版上線、舊版離線與 service worker upgrade。
7. 決定同步 Worker URL 的 onboarding：
   - 可以預填公開的 Worker URL。
   - token 仍只能私下發放，絕不可寫入 repo、bundle 或部署設定。

### 7. 完成發布驗收與 rollback 準備

發布前先：

1. 匯出正式 D1 備份，記錄目前 Worker deployment/version。
2. 保留可立即 rollback 的上一版 Worker 與上一版 Sites version。
3. 準備不含 token 的 smoke-test script。
4. 用測試 token 做 staging 驗收；正式 token 不寫入 shell history、CI log 或測試快照。

## P1：建議與本次一起完成

### CI 品質閘門

新增 CI，在每個 PR 執行：

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

另加：

- Android debug build；固定使用 Android Studio JBR 或 CI JDK。
- iOS simulator build 放在 macOS runner。

### 依賴與 Workers 設定升級

- repo 鎖定 Wrangler `4.92.0`，盤點時 CLI 顯示可升到 `4.113.0`。
- 在獨立 PR 更新 Wrangler/Workers types，重新產生 bindings。
- 驗證後把 `compatibility_date` 從 `2026-05-22` 更新到當時日期。
- 不要把 dependency upgrade 和 3b production cutover 放在同一次不可拆部署。

### 文件與維運

- 把 `NextTasks.md` 更新成目前真實狀態：3b 已有未完成骨架，而不是「尚未開始」。
- 增加 token 新增、撤銷、輪替與成員離開流程。
- 增加 D1 backup/restore、Worker rollback、R2 清理與事故處理 runbook。
- 說明 30 天墓碑限制，以及 attachment queue「回前景重試」的實際保證。

## 行動版發布分流

### 內部側載 / 測試版

1. 所有 Web 變更完成後執行 `pnpm mobile:sync`。
2. 確認 sync 後沒有非預期改動 Xcode signing/team 設定。
3. iOS 用 `.xcworkspace` 建置並在實機測試。
4. Android 產出最新 debug APK，在至少一台 Android 實機測試。
5. 完成下方雙裝置驗收。

### App Store / Google Play

除上述項目外，還需要：

- 唯一且已註冊的 bundle/application id。
- iOS distribution certificate/profile、Archive、版本號與 build number。
- Android release keystore/signing config、AAB、`versionCode`/`versionName`。
- Privacy Policy、支援 URL、商店文案、截圖、分類與年齡分級。
- App Privacy / Google Play Data Safety 揭露：相機、相簿、麥克風、語音辨識、裝置檔案、Bearer token、D1 看板資料與 R2 附件。
- 帳號/資料刪除政策。即使目前是共用 token、沒有一般帳號，也要說明如何撤銷存取與清除雲端資料。

目前 Android `release` 沒有 signing config；iOS 只驗證過不簽章 simulator build，因此兩者都還不是商店可上傳產物。

## 建議實作順序

### Phase A — 範圍與資料正確性（0.5–1 天）

1. 拆分目前工作目錄變更。
2. 決定月報歷史資料規則。
3. 實作 `completedAt`、schema migration 與月報測試。
4. 五道既有品質關卡全綠。

### Phase B — 3b 核心與 staging（3–5 天）

1. 建立 staging Worker/D1/R2。
2. Worker attachment endpoints 強化與 runtime tests。
3. 擴充 platform storage。
4. 串接 upload/delete queue 與 board sync ordering。
5. 串接 remote download/cache。
6. 補 offline、reload、切換 endpoint、失敗重試測試。

### Phase C — 發布工程（1–2 天）

1. CI、generated Worker types、structured logs。
2. Sites project、private deployment、metadata/PWA 修正。
3. 更新 README、NextTasks 與維運 runbook。
4. staging release candidate 全面驗收。

### Phase D — production cutover 與行動版（1–2 天）

1. 備份 D1、記錄 rollback 點。
2. 建立正式 R2。
3. 先部署 Worker，再做附件 API smoke test。
4. 部署 private Web/PWA，再跑瀏覽器/PWA smoke test。
5. `pnpm mobile:sync`，產出 iOS/Android 候選版。
6. 雙裝置實機驗收後才發放。

商店送審資料與審核等待時間不含在以上估算內。

## Release Candidate 驗收清單

### 自動化

- [ ] 工作目錄乾淨，`git diff --check` 通過。
- [ ] `pnpm install --frozen-lockfile` 可從 fresh clone 完成。
- [ ] test、lint、typecheck、Web build、mobile build 全綠。
- [ ] Worker dry-run、generated types check、runtime integration tests 全綠。
- [ ] iOS simulator build 與 Android debug build 全綠。
- [ ] repo、bundle、CI artifacts、logs 都不含明文 token。

### 3a 看板同步

- [ ] 首台裝置可選合併或下載遠端。
- [ ] 第二台裝置收斂到同一看板。
- [ ] 編輯、移動、刪除、離線修改與重連均可收斂。
- [ ] 錯 token 顯示 401 對應訊息，本機資料不受影響。
- [ ] 409 合併後重推與 adopt-remote 分支有自動化整合測試。

### 3b 附件同步

- [ ] A 裝置新增照片/錄音，B 裝置可下載、顯示與播放。
- [ ] 離線新增後重啟 App，回線及回前景後自動補傳。
- [ ] B 裝置先看到 board 參照時，不會永久卡在附件載入失敗。
- [ ] 單一附件移除、刪卡、重設看板都會最終清除 R2。
- [ ] 取消草稿不留下本機或 R2 orphan。
- [ ] 超過 10 MB 有可理解訊息，不上傳、不破壞 board。
- [ ] 切換同步 URL/token 不會把 queue 送到錯誤環境。
- [ ] upload/download/delete 重試不重複、不漏失。

### 月報

- [ ] 完成月份以 `completedAt` 計算。
- [ ] 完成後再編輯不會改變原完成月份。
- [ ] 移出/移回完成欄符合已定義規則。
- [ ] 最近六個月、零資料月份、時區與舊資料 migration 均有測試。

### Web/PWA

- [ ] Sites private URL 可開啟，存取政策符合預期。
- [ ] manifest、metadata、頁面文案與雲端同步現況一致。
- [ ] production HTTPS 下安裝、離線啟動、service worker 升級正常。
- [ ] 瀏覽器附件、麥克風權限拒絕與恢復流程正常。

### iOS / Android

- [ ] 執行過 final `pnpm mobile:sync`，候選版確實包含本次 commit。
- [ ] 相機/相簿、錄音、播放、語音建卡、權限拒絕均通過實機測試。
- [ ] 背景/前景、斷網、重啟、低儲存空間情境不會遺失 board。
- [ ] 簽章、版本號、安裝升級與 rollback 已驗證。

## Production 部署順序與停止條件

1. **D1 備份與 rollback 點**
2. **建立正式 R2**
3. **部署 Worker**
4. **驗證 3a board API 未退化**
5. **驗證 3b attachment API**
6. **部署 private Sites version**
7. **Web/PWA smoke test**
8. **final mobile sync、簽章、實機驗收**
9. **逐步發放**
10. **觀察 Worker errors、D1/R2 用量與同步失敗率**

任一步出現以下情況就停止，不繼續發布下一層：

- 3a board GET/PUT/409 行為改變。
- migration 狀態與預期不同。
- R2 upload/download/delete 任一不一致。
- 雙裝置 board 或附件無法最終收斂。
- 正式 logs 出現 token、附件內容或大量未處理例外。
- Web/PWA 新版離線啟動失敗。

## 官方參考

- Cloudflare Workers 設定：<https://developers.cloudflare.com/workers/wrangler/configuration/>
- Workers production best practices：<https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- D1 migrations：<https://developers.cloudflare.com/d1/reference/migrations/>
- R2 Workers API：<https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
