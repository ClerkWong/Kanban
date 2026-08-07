# Web Beta 搬遷 Cloudflare Workers 規格

- 日期：2026-08-07
- 狀態：設計已核准，未實作
- 前置：流動度量與服務類別 v1 已推送（`3329721`），staging Worker `8070b48c` 已部署

## 1. 問題與目標

Web Beta 目前託管於 OpenAI Sites（`kanban-beta-liddlefang.clerk-wong.chatgpt.site`，
Beta v15，owner-only）。發布工具只存在於 Codex／ChatGPT 環境，Claude Code 環境無法
代發，且流動度量 v1（schema v7）已卡在「Worker 部署完成、Web 無法發布」的狀態。

目標：把 Web Beta 搬到 Cloudflare Workers，使前後端（vinext Worker＋sync Worker＋
D1＋R2）全數落在同一個 Cloudflare 帳號，發布流程可由 repo 內指令完成。

決策記錄（2026-08-07 與使用者確認）：

| 決策 | 選擇 |
| --- | --- |
| 存取控制 | Cloudflare Access（zone-based application，email OTP 白名單） |
| 域名 | `kanban-beta.wongchamber.com`（zone 已在本帳號管理 DNS） |
| 正式站 | `kanban.wongchamber.com`，**本次不建立**，留待 P0-5 production cutover |
| 舊 Sites Beta | 新站驗收通過後立即退場 |
| 部署方式 | 手寫根 `wrangler.jsonc` ＋ `vinext build` ＋ `wrangler deploy`（不用 `vinext deploy` 自動生成） |

## 2. 架構

```text
使用者 → Cloudflare Access（email OTP 白名單）
       → kanban-beta.wongchamber.com（Workers Custom Domain）
       → kanban-beta Worker（worker/index.ts，vinext app-router-entry ＋ ASSETS）
       → 靜態資產（vinext build 產出）
（看板資料仍走既有 kanban-sync-staging Worker＋D1＋R2，本規格不變更）
```

網站 Worker 是無狀態殼：資料在裝置端與 sync Worker，網站只負責 SSR 殼與靜態資產。

## 3. 部署設定（唯一的 repo 變更）

1. 新增根 `wrangler.jsonc`：
   - `name: "kanban-beta"`、`main: "worker/index.ts"`。
   - assets binding 指向 vinext build 產出目錄（以 `pnpm build` 實際輸出為準）。
   - `routes: [{ pattern: "kanban-beta.wongchamber.com", custom_domain: true }]`。
   - **不綁 DB 與 IMAGES**：`db/index.ts` 全 repo 無呼叫點；`next/image` 未使用
     （附件縮圖是原生 `img`）。`/_vinext/image` 路徑保留在 entry 內但無 binding，
     僅在被直接呼叫時回錯誤，可接受。
   - compatibility date 與 flags 依 vinext 0.0.50 文件要求設定。
2. `package.json` 新增 `web:deploy:beta`（build ＋ wrangler deploy）。
3. 刪除 `app/chatgpt-auth.ts`：OpenAI Sites 模板遺留，全 repo 無 import。
4. **不修改任何應用程式碼**。metadata 依 request host 自動推導
   （`app/layout.tsx`），不需設 `NEXT_PUBLIC_SITE_URL`。

## 4. 存取控制

- Cloudflare Zero Trust 建 self-hosted Access application，domain
  `kanban-beta.wongchamber.com`，policy：allow email 白名單（owner email），
  One-time PIN 驗證。
- wrangler OAuth token 無 Zero Trust 寫入權限，**此步由使用者在 dashboard 手動
  完成**；實作計畫須附精確步驟。
- 完成後以 curl 驗證：未帶 Access JWT 的請求收到 302 轉向
  `<team>.cloudflareaccess.com`；不得直接回 200。
- 若 custom domain 部署因 token 權限失敗（wrangler 建 DNS record 需 zone 權限），
  fallback：先部署 workers.dev、回報使用者後於 dashboard 手動掛 custom domain。

## 5. 驗收清單

全部通過才進入退場步驟：

- [ ] `/`、`/privacy`、`/support`、`/app-config.json`、`/manifest.webmanifest`、
      `/sw.js` 通過 Access 後皆回 200。
- [ ] 未授權請求被 Access 擋下（302 至 Access 登入頁）。
- [ ] email/password 登入 → 我的專案 → Project Board 正常。
- [ ] v7 新功能可見：卡面老化天數、加急置頂與統計、服務類別篩選、流動報表。
- [ ] 同步指向 `kanban-sync-staging` 正常（板面編輯後同步成功）。
- [ ] PWA：manifest 有效、service worker 註冊、離線冷啟動可用核心流程。
- [ ] 客製 title `定恆人工智能` 正常顯示。

## 6. 舊站退場（安全閥）

1. **退場前**：使用者在舊站（chatgpt.site）開啟看板、確認同步狀態為「已同步」——
   origin 一換，舊站 localStorage/IndexedDB 即不可回收。
2. 使用者於 ChatGPT 環境停用 Sites 專案。
3. repo 端：移除 `.openai/hosting.json`；README 與 NextTasks 的 Beta URL 改為
   `https://kanban-beta.wongchamber.com`；NextTasks P0-5 記錄正式站規劃
   `kanban.wongchamber.com`。

## 7. 風險與回退

- 退場是最後一步：新站有問題時舊站 v15 仍可用，回退＝繼續用舊站。
- Worker 層回退：`wrangler rollback`（或重新 deploy 上一個 commit 的 build）。
- 無資料風險：資料在 D1/R2 與裝置端，網站是無狀態殼。
- Mobile 不受影響：Capacitor bundle 與網站託管無關。

## 8. 本次不包含

- production 資源（`kanban.wongchamber.com`、production R2、production 3b Worker）
  ——依 NextTasks P0-5 嚴格順序另案執行。
- sync Worker CORS 收斂（P1 既有項目）。
- workers.dev 子域的 Access 保護研究（已改走 zone 域名，不需要）。
- CI 自動部署 Beta（手動 `pnpm web:deploy:beta` 即可，YAGNI）。

## 9. 驗收條件（規格級）

- [ ] `pnpm web:deploy:beta` 從乾淨工作樹一鍵完成 build 與部署。
- [ ] 第 5 節驗收清單全數通過。
- [ ] 舊站退場完成，文件（README、NextTasks）反映新 URL 與正式站規劃。
- [ ] `pnpm test`、lint、typecheck、`pnpm build` 全綠（刪除 chatgpt-auth.ts 後）。
