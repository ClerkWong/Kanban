# 從使用者管理指派專案成員 v1 規格

- 日期：2026-08-12
- 狀態：設計已核准，未實作
- 前置：多看板與看板指派 v1（`665077b`）已合入 main 並部署 staging

## 1. 問題與目標

平台管理的「使用者管理」畫面已顯示每位使用者的「參與專案」件數，空狀態文案也寫著
「建立第一個帳號後，就能將他加入專案」——但**沒有這個入口**。目前唯一能指派專案成員的
地方是專案內的成員面板，且需要該專案的 owner 身分。平台管理者建立帳號後無法接續把人
放進專案，功能鏈是斷的。

目標：讓 workspace owner／admin 在使用者管理畫面，以**使用者為主軸**指派他參與哪些專案
與角色。

決策記錄（2026-08-12 與使用者確認）：

| 決策 | 選擇 |
| --- | --- |
| workspace admin 可指派任何專案的成員 | 允許，留稽核紀錄 |
| admin 自我指派（把自己加進非成員專案） | 允許，留稽核紀錄 |
| 指派範圍 | 只有專案成員身分（owner／member）；**不含看板指派** |
| UI 位置 | 使用者列新增獨立「專案」按鈕與專用 modal，不塞進既有「管理」表單 modal |
| 實作順序 | 先做本功能，日曆檢視（`2026-08-12-calendar-view-design.md`）排在其後 |

## 2. 權限模型

### 2.1 放寬限定在 membership 端點

**不修改 `authorizeProject`**——它同時守著專案改名／封存、看板建立／改名／封存、
工作流欄位管理與看板指派。放寬它等於一次放寬所有 manage 操作，範圍過大。

改為在 `worker-sync/src/memberships.ts` 內加一條並行授權路徑：

> `PUT`／`DELETE /projects/:projectId/members/:userId` 的授權條件為
> **專案 `manage` capability（owner）** 或 **workspace owner／admin**。

其餘 manage 操作行為完全不變。這與日曆規格的做法一致——放寬鎖在單一端點，日後要收回
只需改一處。

### 2.2 已知並接受的權限升級路徑

放行後，workspace admin 可把自己加入任何專案，從而取得該專案的工作內容讀取權——
繞過「未加入專案不能讀工作內容」那條線。使用者已明確決定**接受**，理由是平台管理者
本來就是受信任角色（已可建立與封存專案）。緩解措施是稽核紀錄（§4），不是技術阻擋。

此決定必須寫入 README 的已知限制，讓後續維護者知道這是刻意選擇而非疏漏。

## 3. 端點

### 3.1 新增：使用者的專案 membership 清單

`GET /admin/users/:userId/projects`，workspace owner／admin only（沿用 `users.ts`
既有的 `requireWorkspaceAdmin(context, workspaceId)`，非 admin 一律 **404 `not_found`**，
與該檔既有慣例一致——不洩漏端點存在）。

```jsonc
{
  "userId": "...",
  "memberships": [
    { "projectId": "...", "projectName": "...", "role": "owner", "status": "active" }
  ],
  "requestId": "..."
}
```

- `role` 為對外角色值（`owner`／`member`／`viewer`），沿用既有 `toPublicProjectRole`。
- `status` 為專案狀態（`active`／`archived`）。
- 目標使用者不存在於本 workspace 時回 **404 `user_not_found`**（沿用 `users.ts` 既有錯誤碼）。

### 3.2 沿用並放寬授權：membership 寫入

`PUT`／`DELETE /projects/:projectId/members/:userId` 不新增端點，只依 §2.1 放寬授權。
既有行為全部繼承，不得重寫：

- **last-owner guard**：移除或降級最後一位 owner 時 `meta.changes` 為 0 → **409 `last_owner`**。
- **idempotency**：`putMember` 對相同角色 short-circuit；`deleteMember` 對非成員回 200。
- **原子 audit**：mutation 與 audit 同一 `batch`，audit 寫入失敗則變更完整回滾。
- 目標使用者必須是本 workspace 成員，否則 404 `user_not_found`。

## 4. 稽核

沿用既有 action：`membership.added`／`membership.role_changed`／`membership.removed`。

當**行動者不是該專案的成員**（即走了 §2.1 的放寬路徑）時，metadata 加上
`via: "platform_admin"`——這是既有平台管理者封存／還原專案的慣例
（`projects.ts` 的 `{ via: "platform_admin" }`）。

行動者若同時也是該專案 owner，則**不標** `via`，因為他是以成員身分正常操作。這個區分
讓 Activity Log 能回答「這筆 membership 變更是不是專案外的人做的」。

自我指派不需要額外欄位：Activity Log 的 `actor_user_id` 與 `entity_id` 相同即為自我
指派，本身可稽核。

## 5. 使用者介面

### 5.1 為什麼是獨立按鈕

使用者列既有的「管理」按鈕開啟的是**表單語意** modal（平台角色、狀態、密碼重設，按
「儲存變更」才生效）。專案成員指派是**逐項即時生效**（每個專案一次 API 呼叫）。兩種
語意混在同一 modal 會產生真實誤解：改完專案角色以為還要按「儲存變更」，或反之以為
表單欄位也即時生效。

因此使用者列**新增一顆「專案」按鈕**，開啟專用 modal，其中所有操作即時生效。

### 5.2 專案指派 modal

- 標題沿用既有 modal 結構（`modalEyebrow` 為「使用者管理」，標題為「<顯示名稱> 的專案」）。
- 列出 workspace 內的 **active 專案**，每列：專案名稱、角色選擇、移除按鈕。
  - 角色選擇沿用 `ProjectMembersPanel` 的 `RoleSelect`（`owner`／`member`；`viewer` 只在
    既有值為 `viewer` 時以唯讀選項顯示）。
  - 尚非成員的專案：角色選擇顯示未選狀態，選擇角色即等於加入。
  - 已是成員的專案：顯示目前角色，可改角色或移除。
- 該使用者在 **archived 專案**已有的 membership：唯讀顯示並標示「已封存」，不可改動——
  封存專案不需配置人力，但隱藏會造成「他到底在不在」的困惑。
- 即時生效沿用看板指派已建立的**樂觀更新**模式：先更新本地狀態，成功後以伺服器回應
  覆寫，失敗回滾並顯示錯誤。
- `409 last_owner` 顯示專屬訊息「此專案至少需要一位 owner，請先指派其他 owner。」
  不可使用泛用錯誤文案。
- 變更後刷新使用者列的「參與專案」件數（該欄位由 `/admin/users` 的
  `COUNT(DISTINCT projects.id)` 計算，需重新取得清單）。
- 全部文案繁體中文。

## 6. 測試重點

- 授權：workspace admin 可對**非自己成員**的專案 PUT／DELETE membership；project owner
  行為不變；一般 member／viewer 對這兩個端點仍 403；非 admin 呼叫
  `GET /admin/users/:userId/projects` 回 404。
- 自我指派：admin 把自己加入非成員專案成功，且 Activity Log 的 actor 與 target 相同。
- audit `via` 標記：專案外 admin 操作標 `via: "platform_admin"`；同時是專案 owner 的
  admin 操作**不標**。
- last-owner guard 在放寬路徑下仍生效（admin 移除最後一位 owner 回 409，且該 membership
  仍存在）。
- idempotency：相同角色重複 PUT 回 200 且不產生重複 audit；對非成員 DELETE 回 200。
- `GET /admin/users/:userId/projects` 回傳含 archived 專案的 membership 並正確標 status；
  目標使用者不存在回 404 `user_not_found`。
- 放寬**不外溢**：admin 對非成員專案的 board content GET／PUT、附件、Activity Log
  仍回既有結果（不因本次放寬而可讀）——這是最重要的迴歸斷言。

## 7. 本次不包含

- 看板指派（維持在專案內的成員面板）。
- 批次操作（一次把多位使用者加入同一專案，或一次把一位使用者加入多個專案）。
- 邀請流程、email 通知與指派通知。
- 跨 workspace 指派。
- 從專案端反向查詢「哪些 workspace 使用者尚未加入本專案」的候選清單改良
  （`listMemberCandidates` 已存在，不在本次範圍）。
- 技術阻擋自我指派（已決定以稽核代替阻擋）。

## 8. 驗收條件

- [ ] workspace admin 可從使用者管理把使用者加入專案、改角色、移除。
- [ ] project owner 從專案成員面板的既有行為完全不變。
- [ ] 一般 member／viewer 無法呼叫 membership 寫入端點（403），非 admin 無法呼叫
      `GET /admin/users/:userId/projects`（404）。
- [ ] admin 自我指派成功並留下可辨識的稽核紀錄。
- [ ] 專案外 admin 的 membership 變更在 Activity Log 標 `via: "platform_admin"`。
- [ ] 移除最後一位 owner 回 409，UI 顯示專屬訊息而非泛用文案。
- [ ] archived 專案的既有 membership 唯讀顯示；active 專案可指派。
- [ ] 變更後使用者列的「參與專案」件數更新。
- [ ] 放寬未外溢：admin 對非成員專案的內容、附件與 Log 存取行為不變。
- [ ] README 已記錄「workspace admin 可自我指派專案並取得內容讀取權」為已知限制。
- [ ] `pnpm test`、`pnpm worker:test`、lint、typecheck、Web／mobile build 全綠。
