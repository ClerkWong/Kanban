# 本機 Kanban

離線優先的繁體中文 Kanban。Web/PWA 與 Capacitor iOS、Android 共用同一套
React 看板介面；資料先寫入裝置，使用者可選擇連接 Cloudflare Worker，將看板存入
D1、附件存入 R2，供多裝置共用。

目前正式環境只上線既有的看板同步（3a）。新版月報、附件同步（3b）與 Web/PWA 已完成
本機整合，Web private beta 也已發布；仍須先完成獨立 staging 後端、雙裝置與實機驗收，
才可切換正式資源。完整狀態、順序與停止條件見 [NextTasks.md](./NextTasks.md)。

## 功能

- 看板新增、編輯、拖放、鍵盤移動、搜尋、篩選、WIP 與逾期統計。
- 本機儲存與離線啟動；同步失敗不影響本機編輯。
- 最近六個日曆月的完成報表，以卡片 `completedAt` 計算。
- Web 附件使用 IndexedDB；iOS/Android 使用 Capacitor Filesystem。
- 照片、錄音與原生繁中語音建卡。
- 選用的 D1 看板同步與 R2 附件同步；Bearer token 只由使用者在裝置端輸入。
- PWA manifest、service worker、隱私與支援頁。

## 架構

```text
app/
  components/board/   共用看板 UI
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
pnpm mobile:sync
pnpm mobile:ios
```

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
pnpm sync:dev
```

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

## 同步行為與限制

- 單一共用看板，以 revision 樂觀鎖與卡片級 `updatedAt` LWW 合併。
- 刪除墓碑保留 30 天；離線超過 30 天的舊裝置仍可能讓已刪卡片重新出現。
- 附件上限為 10 MiB。上傳必須先成功，board 才可發布附件參照；刪除則在 board
  不再引用後送出冪等 DELETE。
- 附件 queue 會跨重啟保留，並依同步服務 origin 隔離；不持久化 token。
- 同步服務網址必須使用 HTTPS，只有 localhost/loopback 開發環境可使用 HTTP。
- token 儲存在裝置本機，仍屬敏感憑證；裝置遺失、成員離開或疑似外洩時必須撤銷換發。

## 相關文件

- [NextTasks.md](./NextTasks.md)：目前狀態、後續任務、驗收與 rollback runbook。
- [設計規格](./docs/superpowers/specs/2026-07-14-mobile-app-design.md)
- [3a 同步計畫](./docs/superpowers/plans/2026-07-20-cloud-sync-phase3a.md)
