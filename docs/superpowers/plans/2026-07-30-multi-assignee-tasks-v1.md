# 專案任務多人指派 v1.1 實作計畫

- 日期：2026-07-30
- 對應規格：`../specs/2026-07-30-multi-assignee-tasks-design.md`

## Task 1：Card schema v5 與相容 migration

- 新增 `Card.assigneeUserIds: string[]`，更新 add/update/normalize/clone/draft。
- 接受 v1–v4，輸出 v5；只有 v1–v3 執行舊 completion-time migration。
- 保留 `members` 自由文字，不做姓名猜測。
- 測試多人去重、序列化往返與 v4 `completedAt` 不變。

狀態：已完成。

## Task 2：Project member directory 與多人選擇介面

- 進入 Project route 時載入 Project members。
- 將 member directory 傳入 scoped Board。
- Card 詳情提供可複選負責人，Card 摘要顯示名稱。
- 已離開成員可辨識並可移除；Legacy Board 保持原自由文字介面。

狀態：已完成。

## Task 3：Worker 資料完整性

- Board 建立與更新時解析 canonical assignee IDs。
- 每張 Card 上限 20、人員全集上限 100、格式與重複值驗證。
- 只允許新加入的 IDs 指向目前 Project members。
- 允許已離開成員的既有指派原樣保留。

狀態：已完成。

## Task 4：Activity Log 與自動化驗證

- Board diff 的 changed fields 加入 `assigneeUserIds`。
- 補 client model/draft/migration/diff tests。
- 補 Worker 多指派、outsider rejection、departed preservation integration test。
- 通過 lint、typecheck、Web/mobile build、完整 client/Worker tests。

狀態：已完成；159 個 client tests、49 個 Worker tests、8 個 release tests、lint、
typecheck、Web/mobile build 與 staging Worker dry-run 全部通過。

## Task 5：beta 發布與人工驗收

1. 部署 staging Worker，因新規則在 Worker 端執行。
2. 發布 private beta Web。
3. 以 manager 建立含 manager/contributor/viewer 的多人任務。
4. 以 contributor 修改負責人並跨裝置同步。
5. 以 viewer 確認只讀。
6. 暫時移除一位成員，確認既有指派保留、可移除且不能重新加入。
7. 驗證 Activity Log、revision conflict 與舊版成員文字。

狀態：待執行。

## 後續候選

- 「只看我的任務」與依負責人篩選。
- 跨 Board 的 Project-level 我的任務摘要。
- 指派通知。
- 若實際流程需要逐人確認，再設計 per-assignee state；不得直接把 Card 完成狀態拆開而
  破壞既有月報語意。
