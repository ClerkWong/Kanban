# 待執行任務

最後更新：2026-07-21　目前分支：`main`（已推送至 origin，commit `671f635`）

Kanban mobile 擴展分三階段，皆已合入 main：階段 1（Capacitor 殼）、階段 2（附件 + 語音建卡）、階段 3a（看板雲端同步）。以下為尚未完成或待決的事項。

## 1. 待你操作：階段 3a 雲端同步實機驗收

程式已部署、bundle 已同步進 iOS 專案。連線資訊：

- Worker 網址：`https://kanban-sync.clerk-wong.workers.dev`
- Token：見本機 `.env.sync-tokens`（member-1 / member-2，**機密、未入版控**）

驗收清單：

1. app 右上「同步」pill → 貼網址 + token → 首次選「合併本機與遠端」→ 應變「已同步」
2. 第二台裝置（或 Mac `pnpm dev` 開瀏覽器）以另一組 token 設定 → 應看到同一看板
3. 一端改卡 → 另一端切前景或點 pill「立即同步」→ 變更出現
4. 一端刪卡 → 另一端同步 → 卡片消失且不復活
5. 關 Wi-Fi 改卡（仍可操作）→ pill「待同步/失敗」→ 開 Wi-Fi → 自動或手動重試 → 「已同步」
6. 故意貼錯 token → 出現「憑證無效，請重新設定」而非崩潰，本機資料不受影響

有任何一步不符預期（尤其收斂或 pill 狀態），記下現象，下次用系統化除錯定位根因。

## 2. 待你操作：發放同步 token 給團隊成員

`.env.sync-tokens` 內兩組明文 token 需私下交給成員（連同 Worker 網址）。要新增成員：產生隨機字串 → SHA-256 → `INSERT` 進 D1 `users` 表（作法見 README 同步章節）。

## 3. 待決：語音辨識品質問題

放開建卡的流程正常，但辨識品質你表示「稍後再議」。下次談這題時，先描述症狀（辨識不準／慢／中斷），再決定方向（辨識語言與參數、partial 取用策略、或改接雲端轉寫 — 後者超出目前「僅裝置內建辨識」的範圍設定）。

## 4. 下一階段：3b 附件雲端同步（尚未開始）

目前**附件（照片/錄音）只存在拍攝它的裝置**，其他裝置看到占位/載入失敗 —— 這是已知限制，非 bug。階段 3b 補齊：R2 物件儲存 + 背景上傳佇列（跨重啟持久化、失敗重試）+ 其他裝置按需下載快取 + 刪除時清 R2。啟動時先寫計畫（比照前幾階段：brainstorm → spec → plan → subagent 執行）。

## 5. 已知限制（設計取捨，非缺陷）

- 裝置離線逾 30 天，其上已被他人刪除的卡片可能復活（墓碑 30 天修剪；已載於 README）。
- 同步為單一全團隊共用看板，衝突以卡片級 last-write-wins 合併。

## 6. 遞延的小項（品質債，可批次處理）

散落在各階段審查、判定可延後。完整清單見 `.superpowers/sdd/progress.md`。較值得處理的：

- 建議補一個 `useSync` 層級整合測試（stub fetch）覆蓋 409→合併→重推與 adopt-remote 分支 —— 目前收斂迴圈只有手動推演，無自動化覆蓋（最高價值）。
- Worker create-race：兩個並發 baseRevision-0 PUT，第二個撞主鍵 → 500（客戶端重試轉 409 自癒）；可改 `INSERT ... ON CONFLICT DO NOTHING` 收斂為 409。
- `worker-sync` 的 `compatibility_date` 現為 `2026-05-22`（本機 wrangler 4.92.0 workerd 上限）；日後升級 wrangler 後可調新。
- `board-model` 幾處小事：陳舊測試標題已修部分、`normalizeDeletedCards`/`merge` 用 `cards[id]` truthiness 可改 `Object.hasOwn`、`deleteCard` 用牆鐘時間不可注入測試。
- 附件 UI：busy 期間移除鈕的 stale-closure 競態、`capabilityMessage` 單槽不自動消失。

## 7. 環境備忘

- iOS 用 CocoaPods（`ios/App/App.xcworkspace`，非 `.xcodeproj`）；`DEVELOPMENT_TEAM = Z247G8X22D` 已入版控（`cap sync` 若重寫 pbxproj 可能需重設）。
- 改了 web 元件後：`pnpm mobile:sync` 再於 Xcode ▶ Run 更新 app。
- 五道驗證關卡：`pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`。
- 部署同步 Worker：`pnpm sync:migrate && pnpm sync:deploy`（需 `wrangler login`）。
