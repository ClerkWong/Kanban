# 待執行任務

最後更新：2026-07-23　目前分支：`main`

部署差距與完整實作計畫以 [NextSteps.md](./NextSteps.md) 為準。本檔只保留下一位接手者
需要立即執行的操作與目前真實狀態。

## 目前狀態

- 月報已改以 `completedAt` 計算最近六個日曆月，schema 已升至 v4。
- 3b 用戶端已具備持久化附件 queue、先上傳後推 board、按需下載快取與刪除排序。
- Worker 已加入受限 R2 API、10 MiB 限制、runtime integration tests、generated types 與
  staging 設定。
- Web/PWA 已補 metadata、分享圖、隱私/支援頁與 service worker 修正。
- GitHub Actions 已涵蓋 Web、Worker、Android debug 與 iOS simulator build。
- production 仍只有既有 3a 看板同步；尚未建立 production R2，也未部署本次變更。
- staging Worker/D1/R2 與 staging token 尚未建立。
- `.openai/hosting.json` 尚無 Sites `project_id`，所以沒有可驗證的正式 Web/PWA 關聯。

## 下一步 1：審查並提交本機候選版

先確認工作樹只包含預期變更，再跑：

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

不要把 `.env*`、token、D1 export、原生簽章或測試附件加入版控。

## 下一步 2：建立完全隔離的 staging

需要 Cloudflare 帳號權限，且這些命令會建立遠端資源：

1. 建立 `kanban-sync-staging` D1。
2. 建立 `kanban-attachments-staging` R2。
3. 確認 `worker-sync/wrangler.jsonc` 的 staging bindings 指向以上資源。
4. 執行 `pnpm sync:migrate:staging`。
5. 產生只供 staging 的隨機 token，D1 只寫 SHA-256 hash；明文不得進 shell history、
   repo、CI log 或測試快照。
6. 執行 `pnpm sync:deploy:staging`。
7. 以環境變數執行 `pnpm sync:smoke`。

production R2 必須等 staging 驗收通過後才建立。

## 下一步 3：staging 驗收

至少以兩個獨立瀏覽器 profile 或兩台裝置驗證：

- 看板新增、移動、完成、重開、編輯、刪除與 409 合併最終收斂。
- 完成後再編輯不改變月報月份；UTC 月界線在 Asia/Taipei 顯示正確。
- 照片與錄音可跨裝置下載、顯示、播放。
- 離線新增後重啟，恢復連線或回前景會自動補傳。
- 單附件刪除、刪卡與重設看板最終清除 R2。
- 10 MiB 邊界、錯 token、權限拒絕、切換 URL/token 與下載重試均有可理解結果。
- queue、log、bundle、CI artifact 都不含 token 或附件內容。

## 下一步 4：Web/PWA 與原生候選版

- 建立或連結 Sites project，設定 `NEXT_PUBLIC_SITE_URL`，先發布 private version。
- 驗證 HTTPS 安裝、離線冷啟動、service worker 更新與分享預覽。
- 在候選 commit 上執行 final `pnpm mobile:sync`。
- iOS/Android 實機驗證相機、相簿、錄音、播放、語音建卡、背景/前景與低儲存空間。
- 內部分發前決定版本號、簽章、安裝升級與 rollback。

## 下一步 5：production cutover

嚴格依序：

1. 記錄目前 Worker version，取得 D1 Time Travel bookmark 並另存完整 D1 export。
2. 建立 `kanban-attachments` production R2。
3. 再次確認 production migration 狀態沒有意外差異。
4. 部署 Worker，先驗證既有 3a `/board` GET/PUT/409 行為。
5. 驗證 3b PUT/GET/DELETE、尺寸限制與錯誤 envelope。
6. 發布 private Sites version，完成 Web/PWA smoke test。
7. final mobile sync、簽章、實機驗收後才逐步發放。

任何 D1 migration 不一致、3a 回歸、R2 不收斂、雙裝置不收斂、敏感資料進 log，或
PWA 離線啟動失敗，都必須立即停止後續發布。

## 已知限制

- 墓碑只保留 30 天；離線更久的裝置可能讓舊卡片復活。
- 共用 token 模式不是個人帳號權限模型；成員離開或裝置遺失需人工撤銷換發。
- 附件背景工作目前保證在 app 啟動、上線、回前景、變更與手動同步時重試，不是作業
  系統提供的永久背景程序。
- staging、production、Sites 與實機驗收均是尚未執行的外部工作；本機測試通過不能
  取代這些發布閘門。
