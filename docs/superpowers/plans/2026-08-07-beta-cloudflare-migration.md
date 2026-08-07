# Web Beta 搬遷 Cloudflare Workers 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Web Beta 從 OpenAI Sites 搬到 Cloudflare Workers（`kanban-beta.wongchamber.com`＋Cloudflare Access），使發布流程可由 repo 內指令完成。

**Architecture:** 手寫根 `wrangler.jsonc`（vinext 慣例：`worker/index.ts` entry＋`dist/client` assets），`vinext build` 後以 `wrangler deploy` 部署至 Workers Custom Domain；zone-based Access 由使用者在 dashboard 手動建立；驗收全過後舊 Sites 退場並更新文件。

**Tech Stack:** vinext 0.0.50、wrangler（devDependency）、Cloudflare Workers Custom Domains、Cloudflare Zero Trust Access。

## Global Constraints

- Worker 名稱 `kanban-beta`；域名 `kanban-beta.wongchamber.com`；正式站 `kanban.wongchamber.com` **本次不建立**。
- 根 `wrangler.jsonc` 不綁 DB 與 IMAGES bindings。
- 不修改任何應用程式碼（刪除死碼 `app/chatgpt-auth.ts` 除外）。
- 舊 Sites 退場前，使用者必須先在舊站確認同步狀態為「已同步」。
- 文件為繁體中文，遵循檔內既有排版。
- 本計畫含兩個使用者手動步驟（Access 建立、舊站退場確認），執行者必須停下等待使用者回覆，不得跳過或代辦。

---

### Task 1: 根 wrangler.jsonc、部署 script 與死碼清理

**Files:**
- Create: `wrangler.jsonc`（repo 根目錄）
- Modify: `package.json`（scripts 區）
- Delete: `app/chatgpt-auth.ts`

**Interfaces:**
- Produces: `pnpm web:deploy:beta`（build＋deploy 一鍵指令，Task 2 使用）。

- [ ] **Step 1: 建立根 wrangler.jsonc**

內容（compatibility_date 用今天日期）：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "kanban-beta",
  "compatibility_date": "2026-08-07",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./worker/index.ts",
  "assets": {
    "directory": "dist/client",
    "not_found_handling": "none",
    "binding": "ASSETS"
  },
  "routes": [
    { "pattern": "kanban-beta.wongchamber.com", "custom_domain": true }
  ]
}
```

（依 vinext 0.0.50 `generateWranglerConfig` 模板；不加 DB/IMAGES bindings。）

- [ ] **Step 2: package.json 加 script**

在 `"sync:deploy:staging"` 附近加入：

```json
"web:deploy:beta": "pnpm build && WRANGLER_LOG_PATH=.wrangler/wrangler.log wrangler deploy -c dist/server/wrangler.json",
```

（執行時修正：`worker/index.ts` 的 `virtual:vinext-rsc-entry` 需由
`@cloudflare/vite-plugin` 解析，wrangler 不能直接 bundle 根設定。vite.config.ts 的
cloudflare plugin 會在 `pnpm build` 時讀取根 `wrangler.jsonc` 並輸出可部署的
`dist/server/wrangler.json`（main 為編譯後 index.js、no_bundle），部署一律指向該檔。）

- [ ] **Step 3: 刪除 app/chatgpt-auth.ts**

```bash
git rm app/chatgpt-auth.ts
```

- [ ] **Step 4: 品質關卡**

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

預期全綠（chatgpt-auth.ts 無 import，刪除不影響）。另跑 `pnpm sync:dry-run:staging`
確認 worker-sync 的 `-c worker-sync/wrangler.jsonc` 不受根設定影響。

- [ ] **Step 5: dry-run 驗證根設定**

```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log pnpm exec wrangler deploy --dry-run -c dist/server/wrangler.json
```

預期：bindings 只有 ASSETS，routes 顯示 custom domain。

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc package.json
git commit -m "feat: add Cloudflare Workers deploy config for web beta"
```

### Task 2: 部署與端點驗證

**Interfaces:**
- Consumes: Task 1 的 `pnpm web:deploy:beta`。
- Produces: 運行中的 `https://kanban-beta.wongchamber.com`（Task 3 掛 Access 的對象）。

- [ ] **Step 1: 部署**

```bash
pnpm web:deploy:beta
```

預期：上傳成功、custom domain `kanban-beta.wongchamber.com` 建立（wrangler 會自動建
DNS record 與憑證）。**Fallback**：若因 OAuth token 缺 zone 權限失敗，移除
wrangler.jsonc 的 routes 區塊重部署（落在 workers.dev），回報使用者於 dashboard
手動加 custom domain，再還原 routes 區塊。

- [ ] **Step 2: 端點驗證（Access 尚未啟用，應全部 200）**

```bash
for p in / /privacy /support /app-config.json /manifest.webmanifest /sw.js; do
  curl -s -o /dev/null -w "$p: %{http_code}\n" "https://kanban-beta.wongchamber.com$p"
done
```

預期六項皆 200（憑證生效可能需等數分鐘，523/526/1016 時稍候重試）。
另驗證 `/app-config.json` 內容含 `定恆人工智能`。

### Task 3: Cloudflare Access（使用者手動步驟）

- [ ] **Step 1: 提供使用者 dashboard 步驟並等待完成**

告知使用者於 [one.dash.cloudflare.com](https://one.dash.cloudflare.com)：
1. Zero Trust → Access → Applications → Add an application → Self-hosted。
2. Application name：`Kanban Beta`；Session duration 依喜好（建議 1 週）。
3. Public hostname：`kanban-beta.wongchamber.com`（整站，path 留空）。
4. Policy：Action **Allow**，Include → Emails → 填入允許的 email（owner）。
5. 登入方式保留 One-time PIN 即可，儲存。

**停下等待使用者回覆完成，不得代辦或跳過。**

- [ ] **Step 2: 驗證 Access 生效**

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "https://kanban-beta.wongchamber.com/"
```

預期：302 且 redirect_url 指向 `*.cloudflareaccess.com`。六個端點抽驗 `/` 與
`/sw.js` 皆 302；不得出現未授權 200。

### Task 4: 使用者驗收（手動步驟）

- [ ] **Step 1: 請使用者於瀏覽器完成驗收清單並回報**

1. 開 `https://kanban-beta.wongchamber.com`，email OTP 通過 Access。
2. email/password 登入 → 我的專案 → 進入 Project Board。
3. 確認 v7 新功能：卡面「此欄 N 天」、加急置頂與統計列「加急 N/1」、服務類別篩選、
   📊 流動報表（Cycle Time／阻塞／流動效率）。
4. 編輯一張卡確認同步（staging Worker）成功。
5. 標題顯示 `定恆人工智能`；PWA 可安裝（或至少 manifest 無錯）。

**任何一項失敗即停止，回報後修正；全過才進 Task 5。**

### Task 5: 舊站退場與文件更新

- [ ] **Step 1: 使用者確認舊站已同步（安全閥，手動步驟）**

請使用者開啟舊站 `https://kanban-beta-liddlefang.clerk-wong.chatgpt.site`，確認同步
狀態為「已同步」。**等待確認，未確認不得繼續。**

- [ ] **Step 2: 使用者停用 Sites 專案（手動步驟）**

於 ChatGPT／Codex 環境停用該 Sites 專案。等待回報（也可與 Step 1 一併回報）。

- [ ] **Step 3: repo 清理與文件**

```bash
git rm .openai/hosting.json
```

- README.md：Beta 相關描述改為 `https://kanban-beta.wongchamber.com`（Cloudflare
  Workers 託管、Access 保護），加一行 `pnpm web:deploy:beta` 發布方式。
- NextTasks.md：
  - 「目前真實狀態」表 Web/PWA 列改為 Cloudflare Beta（v16 語意：`736d2ce` 之後的
    最新 commit），註明 Access 保護與部署指令。
  - P0-5 前置條件加一行：正式站規劃 `kanban.wongchamber.com`（zone 已在 Cloudflare，
    cutover 時掛 custom domain 與 Access／公開策略決策）。
  - Sites 關聯列改為「已退場」。

- [ ] **Step 4: 品質關卡與 commit**

```bash
pnpm test && pnpm lint && pnpm typecheck
git add -A
git commit -m "docs: move web beta to Cloudflare Workers"
git push
```

（`pnpm build` Task 1 已驗，本 task 只動文件。）
