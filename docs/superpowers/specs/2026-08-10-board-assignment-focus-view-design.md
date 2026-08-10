# 多看板與看板指派專注視圖 v1 規格

- 日期：2026-08-10
- 狀態：設計已核准，未實作
- 前置：流動度量與服務類別 v1（schema v7）已上線 Beta；`2026-08-03-project-admin-owner-member-design.md` 的單看板收斂由本規格取代

## 1. 問題與目標

2026-08-03 起產品收斂為「一個 Project 一個主要 Board」，並在 migration `0003`
以唯一索引 `boards_one_active_per_project_unique` 在資料庫層硬性限制每專案只能有
一個 active Board。實際使用後確認需要多看板：同一專案有多條並行工作流。

同時要避免多看板帶來的認知負擔：**一般成員只該看到自己該做的任務**，不需要看板
切換，也不需要靠篩選找出自己的板；看板的分配與跨板總覽屬於管理職能。

目標：

1. owner 可在一個 Project 內建立多個 Board。
2. owner 指派每位 member 可存取的 Board（一到多個）。
3. 被指派單一 Board 的 member 進專案直接落在該板，介面沒有看板切換器。
4. member 對未被指派的 Board 完全不可見——不只 UI 隱藏，Worker 強制。

決策記錄（2026-08-10 與使用者確認）：

| 決策 | 選擇 |
| --- | --- |
| 單板歸屬由誰決定 | owner 指派 |
| 指派基數 | 一到多個 Board |
| 未指派 Board 的可見性 | 完全不可見（Worker 強制） |

## 2. 資料模型

### 2.1 移除單看板限制

migration `0005`：

```sql
DROP INDEX IF EXISTS boards_one_active_per_project_unique;
```

`0003` 當時封存的歷史 Board 維持 archived，不自動還原——owner 可用既有
restore 能力自行決定。每專案 active Board 數上限沿用既有 UI／Worker 規則，
本規格不新增上限。

### 2.2 看板指派表

```sql
CREATE TABLE project_member_boards (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id, board_id),
  FOREIGN KEY (project_id, user_id) REFERENCES project_members(project_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX project_member_boards_user_idx
  ON project_member_boards(project_id, user_id);
```

用 join table 而非 membership row 上的 JSON 欄：可逐筆審計、可加索引，
且與既有 append-only Activity Log 慣例一致。

### 2.3 可見 Board 集合的判定

| 角色 | 可見 Board |
| --- | --- |
| Project owner（歷史命名 `manager`） | 專案內全部 Board，不需指派列 |
| Project member（歷史命名 `contributor`） | `project_member_boards` 內的 Board；**若該 member 完全沒有指派列，視同指派至專案主要 Board**（active Board 中 `updated_at` 最新者，同值時取 `id` 較大者——與 `0003` 的 preferred 判定同一規則） |
| legacy viewer | 專案內全部 Board，唯讀（維持現狀，本次不變） |
| workspace admin 未加入專案 | 不可讀工作內容（維持現狀） |

「沒有指派列＝主要 Board」這條 fallback 讓升級零中斷：既有 member 在 owner
尚未細分指派前照常運作。owner 一旦為某 member 建立任何指派列，fallback
即對該 member 失效，可見集合完全由指派列決定。

邊界情況：member 唯一被指派的 Board 被封存時，指派列仍存在，fallback 不啟動，
該 member 看到的是這個 archived Board（唯讀，與既有封存行為一致）。要讓他回到
可寫的主要 Board，owner 需改指派或清除指派列。這是刻意選擇——自動改派會讓
可見範圍在 owner 未察覺時變動。

## 3. Worker 強制

- Board metadata、content GET/PUT、附件 PUT/GET/DELETE、board-scoped Activity Log：
  member 對非可見 Board 一律回 **404**（不是 403）。理由：403 會洩漏該 Board 存在，
  與既有「未參與 Project 者不得列出、讀取或猜測內容」原則一致。
- Board 列表 API：member 只回可見 Board。
- Project summary 與流動報表：member 只聚合可見 Board；owner 全聚合。
  `includeArchived` 行為不變。
- 指派 API（owner-only）：
  - `GET /projects/:projectId/members/:userId/boards` 回目前指派。
  - `PUT /projects/:projectId/members/:userId/boards` 以完整集合覆寫指派
    （body `{ "boardIds": [...] }`）。空陣列代表「清除指派」，該 member 回到
    2.3 的主要 Board fallback；要讓 member 看不到任何 Board 應改為移除 membership。
  - 只接受同專案、active 或 archived 的既有 boardId；不合法回 400。
  - 覆寫為原子操作，與既有 membership API 同樣具 idempotency 與 audit 回滾。
- Activity Log 新增 `member.boards_assigned`，metadata 只含 `userId` 與
  `boardIds`，不含 Board 名稱或卡片內容。

## 4. 使用者介面

- **member、單一可見 Board**：進入專案直接載入該 Board，**不顯示看板切換器**，
  也不顯示專案總覽的看板清單。畫面就是任務。
- **member、多個可見 Board**：顯示精簡切換器，只列可見 Board。
- **owner**：完整看板切換器與專案總覽（現狀），另加：
  - 「新增看板」按鈕：把目前無人引用的 `app/components/projects/CreateBoardModal.tsx`
    重新接回專案總覽，owner-only。
  - 成員管理面板每位 member 一組看板多選，沿用多人指派既有的成員多選互動模式。
- **legacy viewer**：維持現狀。
- 指派被移除後，member 若正停留在該 Board：同步收到 404，UI 顯示
  「您已不在此看板」並導回可見 Board（或專案清單），本機快取不刪除。

## 5. 同步與離線

- 離線快取、revision 與 attachment queue 本就 per-Board scope，不需變更。
- 404 已是既有的「停止自動重試」條件，指派移除後不會無限重試。
- 舊版 client（不知道指派概念，含目前已部署的 mobile build 6）：member 若存取
  非可見 Board 會收到 404，走既有錯誤呈現路徑；驗收須確認訊息可理解、不崩潰。

## 6. 測試重點

- migration `0005`：唯一索引移除後可建立第二個 active Board；`0003` 封存的
  Board 維持 archived；新表 FK 與 cascade 正確（移除 membership 連帶清除指派列）。
- fallback：無指派列的 member 只看到主要 Board；主要 Board 判定與 `0003` 一致。
- 指派生效：建立指派列後 fallback 失效；多板 member 看到全部指派板。
- 404 邊界：member 對非可見 Board 的 content GET/PUT、附件三動作、Log 都回 404；
  owner 同樣路徑回 200。
- summary：member 的聚合不含非可見 Board 的卡片與流動度量；owner 全聚合。
- 指派 API：非 owner 呼叫回 403；跨專案 boardId 回 400；空陣列回到 fallback；
  重複 PUT idempotent；audit 寫入失敗時指派變更完整回滾。
- Activity Log 不含 Board 名稱或卡片內容。

## 7. 本次不包含

- 跨 Board 搬移卡片。
- Board 層級的 viewer 角色（目前唯讀性仍由 Project role 與 archive 狀態決定）。
- 指派變更的通知或推播。
- 跨 Board 的「我的任務」聚合視圖。
- 每專案 active Board 數量上限的調整。
- legacy viewer 的可見範圍收斂。

## 8. 驗收條件

- [ ] owner 可在同一 Project 建立多個 active Board，切換與封存正常。
- [ ] owner 可指派 member 一到多個 Board，並可改為只留一個。
- [ ] 單一可見 Board 的 member 進專案直接看到任務，畫面無看板切換器。
- [ ] 多可見 Board 的 member 只看到被指派的板。
- [ ] member 對非可見 Board 的 content、附件與 Log 一律 404；owner 正常。
- [ ] 無指派列的既有 member 升級後仍可正常使用主要 Board。
- [ ] Project summary 對 member 只聚合可見 Board，對 owner 全聚合。
- [ ] 移除指派後，該 member 的 client 停止重試並顯示可理解訊息，本機資料不遺失。
- [ ] 指派變更寫入 Activity Log，且不洩漏 Board 名稱與卡片內容。
- [ ] `pnpm test`、`pnpm worker:test`、lint、typecheck、Web／mobile build 全綠。
