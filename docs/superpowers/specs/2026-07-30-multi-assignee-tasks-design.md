# 專案任務多人指派 v1.1 規格

- 日期：2026-07-30
- 狀態：第一階段已實作，待 beta 驗收
- 前置規格：`2026-07-24-multi-project-multi-board-design.md`

## 1. 問題與目標

Project Board 上的 Card 是專案任務，因此負責人必須引用真正的 Project member，不能只
靠自由輸入姓名。單一任務可由 0 到多位成員共同負責。

第一階段的「多人共同完成」定義為：

- Card 可有多位負責人。
- Card 仍只有一個欄位位置與一個 `completedAt`；任何有編輯權的人把 Card 移到完成欄，
  就代表整個任務完成。
- 不建立每位負責人的個別完成狀態，也不要求所有負責人逐一確認。

## 2. 領域模型

`Card` 新增：

```ts
type Card = {
  // existing fields...
  assigneeUserIds: string[];
  members: string[]; // legacy display text only
};
```

規則：

1. `assigneeUserIds` 引用 `project_members.user_id`，順序只影響顯示，不代表主要／次要。
2. 每張 Card 最多 20 位負責人；每個 Board payload 最多出現 100 個不同負責人。
3. 相同 user ID 在同一張 Card 不得重複。
4. `Card.members` 保留給 v1–v4 舊資料，不是正式指派、不是 ACL，也不自動轉成 user ID。
5. Board schema 由 v4 升為 v5。讀取 v1–v4 時補上空的 `assigneeUserIds`；v4 的
   `completedAt` 不得因 migration 被重算。

## 3. 成員與權限

- manager、contributor 可新增／移除 Card 負責人。
- viewer 可查看負責人，但不可修改。
- 被指派不會額外取得 Project 或 Board 權限；Project membership 仍是唯一授權來源。
- 新增的負責人必須是當下的 Project member，Worker 必須驗證。
- manager、contributor、viewer 都可被指派。

## 4. 成員離開專案

移除 Project membership 時不批次改寫歷史 Board：

- 已存在的指派保留，介面顯示「已離開專案的成員」。
- 後續 Board 更新可保留這個既有 ID，避免整張 Board 因歷史資料無法同步。
- 使用者可從 Card 移除該指派；移除後不能重新加入，除非對方先恢復 Project membership。
- Activity Log 與月報歷史不因 membership 移除而改寫。

## 5. 使用者介面

Project Board 的 Card 詳情使用「任務負責人（可複選）」：

- 選項來源為 `GET /projects/:projectId/members`。
- 顯示成員名稱與 Project role。
- Card 摘要列顯示所有目前負責人的名稱。
- 無法解析的舊 user ID 顯示短 ID；舊 `members` 文字另標示為「舊版成員」，避免被誤認
  為正式指派。
- Legacy local Board 沒有 Project member directory，繼續使用原本的自由文字欄位。

## 6. 同步與稽核

- `assigneeUserIds` 隨 BoardState 走既有 per-Board revision、離線儲存及 Card-level LWW。
- Worker 只驗證「新加入」的負責人。既有但已離開專案的負責人可以原樣保留。
- 指派變更寫入既有 `card.updated` Activity Log，`fields` 包含
  `assigneeUserIds`；Log 不記錄 Card description 或 token。
- revision conflict 使用既有流程處理，不另建 assignment API 或 D1 join table。

## 7. 第一階段不包含

- 每位負責人的個別接受、開始、完成或工時狀態。
- 主要負責人、百分比責任或核准流程。
- 指派通知、Email／LINE 推播。
- 跨專案「我的任務」、工作量統計或依負責人月報。
- 外部協作者、非 Project member 的臨時指派。

## 8. 驗收條件

- [x] 一張 Card 可選擇多位 Project members，儲存、重載與同步後不遺失。
- [x] 重複 user ID 由 client 正規化；Worker 拒絕不合法或超量的指派資料。
- [x] Worker 拒絕新指派非 Project member。
- [x] 成員離開後，既有指派仍可保留並可由編輯者移除。
- [x] viewer 只能查看；manager/contributor 可修改。
- [x] v4 migration 不重算 `completedAt`，舊 `members` 文字不自動誤配。
- [x] Activity Log 能辨認 `assigneeUserIds` 欄位變更。
- [ ] beta 以 manager、contributor、viewer 三種角色進行瀏覽器人工驗收。
- [ ] 兩個裝置同時修改負責人時，確認既有 revision conflict／merge 體驗可接受。
