# Kanban 後續任務與發布 Runbook

- 最後更新：2026-07-24
- 目前分支：`main`
- 已推送基準：`bd17e5b`（`Prepare Kanban beta release`）

本文件整併先前兩份規劃，是後續工作、驗收與發布順序的單一依據。
已完成的歷史實作只保留結果與證據；未完成項目依實際執行順序排列。

## 目前真實狀態

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| 月報資料模型 | 已完成 | 以 `completedAt` 計算最近六個日曆月；schema v4 可遷移 v1/v2/v3 |
| 3b 附件用戶端 | 已完成本機實作 | 有持久化 upload/delete queue、先上傳後推 board、按需下載與重試 |
| Worker 3b | 已完成本機實作 | 有 R2 API、10 MiB 限制、request ID、結構化錯誤、409 與 runtime tests |
| staging 設定 | 已完成設定，尚無遠端資源 | Wrangler environment、scripts 與 dry-run 已存在 |
| CI | 已完成 | PR/main 會驗證 Web、Worker、Android debug 與 iOS simulator |
| Web/PWA | private beta 已發布 | [Kanban Beta](https://kanban-beta-liddlefang.clerk-wong.chatgpt.site)，目前僅擁有者可存取 |
| Sites 關聯 | 已完成 beta 關聯 | `.openai/hosting.json` 已保存 beta `project_id`；Sites 本身不擁有同步 D1/R2 |
| 客製 title | 已完成本機實作，尚未提交或發布 | `public/app-config.json` 控制畫面與 WebView title；目前 beta v1 尚未包含 |
| staging Worker/D1/R2/token | **尚未建立** | 下一個外部部署工作 |
| production Worker/D1 | 既有 3a 上線 | 尚未部署本次 3b Worker |
| production R2 | **尚未建立** | 必須等 staging 驗收全數通過 |
| iOS/Android | 可建置，未完成發行 | 尚缺實機、簽章、版本與內部分發／商店流程 |

### 已完成的驗證

- 已推送候選版曾通過 52 個單元測試、8 個 Worker runtime tests、lint、typecheck、
  Web/mobile build、production/staging Worker dry-run、Android debug build、未簽章
  iOS simulator build 與 final mobile sync。
- 目前尚未提交的客製 title 變更已通過 56 個單元測試、lint、typecheck、Web build、
  mobile build 與完整 `pnpm mobile:sync`。
- `main` 已推送至 GitHub；private beta v1 的來源是同一個 `bd17e5b`。

## P0-1：提交客製 title 並更新 beta

目前工作目錄包含尚未提交的 title 設定與本文件合併。先完成：

1. 在 `public/app-config.json` 設定預期的 beta title。
2. 確認設定為非空字串且不超過 80 個字元。
3. 重跑最小品質關卡：

   ```bash
   pnpm test
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm mobile:sync
   git diff --check
   ```

4. 審查 diff，提交並推送。
5. 從同一個 commit 儲存新的 Sites version，發布到既有 private beta。
6. 驗證：
   - 看板主標題與瀏覽器分頁 title 使用 JSON 值。
   - 線上重新整理會取得新設定。
   - 離線時退回最後成功快取或內建預設。
   - `/privacy`、`/support` 與 PWA 核心流程沒有回歸。

限制：iOS/Android 會把 JSON 包入 App，修改後仍需 `pnpm mobile:sync` 與新 build。
手機桌面圖示下方的 App 名稱是原生 metadata，不能只靠 App 重啟變更。若未來要求已安裝
App 在不更新版本的情況下取得新 title，需要另外設計公開且可驗證的遠端設定端點。

## P0-2：建立完全隔離的 staging

正式資源不得拿來測試 3b。建立以下獨立資源：

| 類型 | staging 名稱 | production 名稱 |
| --- | --- | --- |
| Worker | `kanban-sync-staging` | `kanban-sync` |
| D1 | `kanban-sync-staging` | `kanban-sync` |
| R2 | `kanban-attachments-staging` | `kanban-attachments` |
| Token | staging 專用 | production 專用 |

依序執行：

1. 建立 `kanban-sync-staging` D1。
2. 將實際 `database_id` 固定寫回 `worker-sync/wrangler.jsonc` 的 staging binding。
3. 建立 private `kanban-attachments-staging` R2。
4. 執行 `pnpm sync:migrate:staging`。
5. 產生只供 staging 使用的高熵 token：
   - D1 只儲存 SHA-256 hash。
   - 明文不得進 repo、shell history、CI log、測試快照或前端 bundle。
6. 執行 `pnpm sync:deploy:staging`。
7. 以環境變數執行只讀 smoke test：

   ```bash
   KANBAN_SYNC_URL="https://<staging-worker>" \
   KANBAN_SYNC_TOKEN="<staging-token>" \
   pnpm sync:smoke
   ```

8. 記錄 staging URL、資源 ID、token 建立日期與撤銷方式，但不記錄 token 明文。

完成條件：

- staging board、token、D1 與 R2 和 production 完全隔離。
- staging 失敗或清除資料不影響既有 production 3a。
- 未帶 token、錯 token 與有效 token 分別得到預期結果。
- Worker logs 沒有 Bearer token 或附件內容。

## P0-3：staging Release Candidate 驗收

至少使用兩個獨立瀏覽器 profile，並加入一台 iOS 或 Android 實機。所有項目通過前，
不得建立 production R2 或部署 production 3b。

### 自動化

- [ ] 工作樹乾淨，`git diff --check` 通過。
- [ ] `pnpm install --frozen-lockfile` 可從 fresh clone 完成。
- [ ] `pnpm test`、`pnpm worker:test`、lint、typecheck 全綠。
- [ ] Web build、mobile build、generated Worker types check 全綠。
- [ ] production/staging Worker dry-run 全綠。
- [ ] Android debug 與 iOS simulator build 全綠。
- [ ] repo、bundle、CI artifacts 與 logs 都不含明文 token。

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

### 3a 看板同步

- [ ] 首台裝置可選擇合併或採用遠端看板。
- [ ] 第二台裝置最終收斂到同一看板。
- [ ] 新增、編輯、移動、完成、重開與刪除均可收斂。
- [ ] 離線修改後重啟，恢復連線或回前景會自動同步。
- [ ] 409 合併與 adopt-remote 分支不遺失較新的卡片。
- [ ] 錯 token 顯示可理解訊息，本機資料不受影響。

### 3b 附件同步

- [ ] A 裝置新增照片或錄音，B 裝置可下載、顯示與播放。
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

- [ ] private beta 存取政策符合預期。
- [ ] JSON title、metadata、分享預覽與頁面主標題一致。
- [ ] HTTPS 安裝、離線冷啟動及 service worker 升級正常。
- [ ] 新版設定線上立即取得，離線仍有可用 fallback。
- [ ] 瀏覽器附件與麥克風權限拒絕／恢復流程正常。
- [ ] `/privacy` 與 `/support` 可開啟。

### iOS / Android 實機

- [ ] 候選 commit 上執行過 final `pnpm mobile:sync`。
- [ ] 相機、相簿、錄音、播放與繁中語音建卡正常。
- [ ] 權限拒絕後不崩潰，重新授權可恢復。
- [ ] 背景／前景、斷網、重啟與低儲存空間不遺失 board。
- [ ] App 內 title 使用候選 JSON 值。

## P0-4：production cutover

### 前置條件

- staging 上述清單全部通過並記錄證據。
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
| staging 資源建立與初始部署 | 0.5–1 天 |
| 雙裝置、Web/PWA 與實機驗收 | 1–2 天 |
| production 備份、cutover 與觀察 | 1 天 |
| 商店資料、簽章與審核 | 另案估算 |

## 官方參考

- Cloudflare Workers 設定：<https://developers.cloudflare.com/workers/wrangler/configuration/>
- Workers environments：<https://developers.cloudflare.com/workers/wrangler/environments/>
- D1 migrations：<https://developers.cloudflare.com/d1/reference/migrations/>
- D1 Time Travel：<https://developers.cloudflare.com/d1/reference/time-travel/>
- R2 Workers API：<https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- Workers rollback：<https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
