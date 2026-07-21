# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Mobile（Capacitor）

行動版把 `app/components/board/` 的同一套看板元件，經 `mobile/` 入口以純 Vite 打包成靜態 bundle，交給 Capacitor 原生殼載入（不註冊 service worker）。

- `pnpm mobile:build`：打包 `dist/mobile`
- `pnpm mobile:sync`：打包並同步到原生專案
- `pnpm mobile:ios`：開啟 Xcode（實機側載用個人簽章）
- 改了 web 元件後，重跑 `pnpm mobile:sync` 即可更新 app 內容
- Fresh clone 後請先跑 `pnpm install && pnpm mobile:sync`，原生專案引用的同步產物（iOS `App/public`、Android sync 檔）不入版控，未同步前無法建置

原生能力（階段 2）：卡片附件（拍照/相簿、錄音）與按住說話的語音建卡（繁中，裝置內建辨識）。附件檔案存於裝置本地（原生 Filesystem / 瀏覽器 IndexedDB），看板資料只存參照；行動 app 與瀏覽器的資料各自獨立，雲端同步屬後續階段。

## 雲端同步（階段 3a）

看板經 `worker-sync/`（Cloudflare Worker + D1）跨裝置同步：單一共用看板、Bearer token 認證、revision 樂觀鎖，衝突以卡片級 updatedAt LWW 合併（刪除有墓碑保護）。離線優先 — 本機永遠可用，恢復連線後自動補推。

- 啟用：看板右上「同步」pill → 輸入 Worker 網址與 token
- 部署：`pnpm sync:migrate && pnpm sync:deploy`（需 `wrangler login`；database_id 在 `worker-sync/wrangler.jsonc`）
- 發 token：產生隨機字串，SHA-256 後 INSERT 進 D1 `users` 表（明文交給成員）
- 附件檔案的雲端同步屬階段 3b，目前附件僅存於擷取它的裝置
- 已刪卡片的墓碑保留 30 天；若某裝置離線超過 30 天後才重新連線，其上仍存在的、已被他人刪除的卡片可能重新出現（與附件僅存本機同屬已知限制）

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
