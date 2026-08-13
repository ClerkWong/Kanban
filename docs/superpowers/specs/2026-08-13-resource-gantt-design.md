# 人力甘特圖 v1 規格

- 日期：2026-08-13
- 狀態：已核准，待實作計畫
- 前置：跨專案日曆檢視 v1（`docs/superpowers/specs/2026-08-12-calendar-view-design.md`）

## 1. 問題與目標

日曆檢視回答「這個月有哪些任務要推進」——任務與時間的交集。它回答不了「這段期間誰有空、
誰被壓住」。管理者要調配人力時，需要的是人員與時間的交集。

本功能提供一張以人為列、以日期為軸的甘特圖。每一條代表「某個人在某張卡片上的一段投入
期間」。同一張卡片會同時出現在多個人的列上——那就是協作；同一個人同一天出現兩條以上——
那就是過載訊號。

目標使用者是管理者（workspace owner／admin 與 Project owner）。目標決策有兩個：派工前先
看誰有空檔；派工後檢查有沒有人被排爆。

### 1.1 為什麼需要新的日期欄位

卡片目前只有 `dueDate` 一個日期（`app/board-model.ts` 的 `Card`）。`startedAt` 是「首次離開
第一欄」的實際時間戳，`createdAt` 是建立時間，兩者都是實際進度而非計畫排程。日曆檢視把卡片
放進某一格只需要一個日期；甘特條需要兩端，所以必須新增排程日期。

決議是把排程日期放在**每位指派人**身上，不放在任務層級：同一張卡片下，律師甲投入 8/7–8/13、
工程師丙投入 8/7–8/12 是常態，不是例外。任務層級不再另有一組排程日期。

## 2. 資料模型（Card schema v8）

`Card` 新增一個欄位：

```ts
export type AssignmentWindow = {
  /** 必須是同一張卡 assigneeUserIds 內的 ID。 */
  userId: string;
  /** YYYY-MM-DD，含當日。 */
  startDate: string;
  /** YYYY-MM-DD，含當日；不得早於 startDate。 */
  endDate: string;
};

// Card 新增：
assignmentWindows: AssignmentWindow[];
```

規則：

1. `assigneeUserIds` **維持**為權威指派名單。授權驗證、篩選、日曆聚合、Activity Log 都靠它，
   本次不改其語意。`assignmentWindows` 是疊在上面的排程層，其 `userId` 必須是 `assigneeUserIds`
   的子集。
2. 每個 `userId` 最多一筆 window。重複 `userId` 視為無效輸入。
3. 陣列長度上限沿用 `MAX_ASSIGNEES_PER_CARD = 20`（`worker-sync/src/boards.ts`）。
4. **缺 window 不是錯誤，是「未排期」**。指派了人但還沒排期間，是流程中的正常中間狀態，
   由畫面把缺口列出來推動管理者補，而不是用錯誤訊息封鎖編輯。
5. `dueDate` 保留原語意（任務截止日）。日曆檢視、逾期統計、卡面逾期標示都繼續使用它。
   甘特條完全由 `assignmentWindows` 決定，兩者互不推導。
6. `normalizeBoard` 必須是幂等的：丟棄 `userId` 不在 `assigneeUserIds` 內的 window、丟棄
   日期格式錯誤或 `endDate < startDate` 的 window、同一 `userId` 重複時保留第一筆。

### 2.1 Migration v7 → v8

一律補 `assignmentWindows: []`。**不替舊卡推導日期**——用 `dueDate` 或 `startedAt` 猜出來的
排程會被管理者誤讀為「他排過的班」，比空白更糟。有指派人的舊卡在甘特圖上落在「未排期」
清單；完全沒有指派人的卡片不會出現在人力甘特圖上，那是日曆檢視的守備範圍。

### 2.2 多裝置合併

`assignmentWindows` 隨卡片整體 LWW 合併，不做欄位級合併。兩台裝置同時改同一張卡的不同人
期間時，後寫入者整份覆蓋。這與 `blockedMs` 已接受的精度取捨一致，理由相同：維持卡片級 LWW
的簡單性。此限制須寫入 README 已知限制。

## 3. 權限：指派與期間收斂為 Project owner

產品規則：一個看板需要管理者，由管理者負責分派任務。

因此 `assigneeUserIds` 與 `assignmentWindows` 都只有 Project owner（D1 `manager`）可以變更。
這是一次**權限收緊**，方向與先前三次放寬相反：`任務多人指派 v1.1` 上線時 member
（`contributor`）可以改指派名單，本次起不行。

### 3.1 實作手法：簽章比對

複用現成機制。`worker-sync/src/boards.ts` 已經用 `settingsSignature` 比對前後版本，擋下
非 owner 對 board settings 的變更。同樣算一個 `assignmentSignature`：

- 輸入是整份 board 的所有卡片，逐卡取 `assigneeUserIds` 與 `assignmentWindows`，以卡片 id
  排序後序列化。
- 非 owner 送上來的 board 若簽章與前一版不同 → 403。其餘卡片欄位照舊可改。

### 3.2 絕對不能重演的坑

舊 board 的卡片沒有 `assignmentWindows` 鍵。簽章計算必須把「鍵不存在」與「空陣列」視為
相同，否則 v8 客戶端一律送空陣列、舊資料沒有此鍵，member 對任何舊看板的任何編輯都會被
判定為「變更了指派」而 403 鎖死。

這正是流動度量 v7 上線前一刻抓到的 absent-settings 403 lockout。同一個坑不接受第二次。

### 3.3 UI 與稽核

- member 在卡片編輯面板看到的指派區與期間區為唯讀，並說明「指派由專案管理者負責」。
- Activity Log 沿用既有慣例：只記欄位名稱變更，新增 `assignmentWindows` 為可記欄位。
  不記日期內容——日期本身不敏感，但保持與 `blockedReason` 一致的「只記欄位」原則，
  避免 Log 成為工作內容的旁通管道。

## 4. 端點

```
GET /assignments?workspaceId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
```

- 範圍解析直接複用 `resolveCalendarScope`（`worker-sync/src/calendar.ts`）：workspace
  owner／admin 得到該 workspace 全部 active 專案；Project owner 得到他 own 的；其餘 403；
  非 workspace 成員 404。
- `from`／`to` 為 date-only，`from <= to`，窗長上限含頭尾共 31 天（超出回 400
  `invalid_range`）。格式不符同樣回 400 `invalid_range`。
- 回傳：

```ts
type ResourceData = {
  from: string;
  to: string;
  scope: "workspace" | "owned_projects";
  /** 可見專案的全體成員，含這段期間完全沒有條子的人——空白列就是可派工的訊號。 */
  people: Array<{ userId: string; displayName: string }>;
  /** 每筆 = 某人在某卡的一段投入期間，且與查詢窗有交集。 */
  bars: Array<{
    userId: string;
    cardId: string;
    title: string;
    startDate: string;
    endDate: string;
    projectId: string;
    projectName: string;
    boardId: string;
    boardName: string;
    blocked: boolean;
    serviceClass: ServiceClass;
  }>;
  /** 有指派、無 window 的卡片，供管理者補排期。 */
  unscheduled: Array<{
    cardId: string; title: string; userId: string;
    projectId: string; projectName: string; boardId: string; boardName: string;
  }>;
  barsTruncated: boolean;
  unscheduledTruncated: boolean;
  boardsTruncated: boolean;
  requestId: string;
};
```

- 只含未完成卡（`completedAt` 為 null）與 active 專案的 active 看板，與日曆一致。
- 不含描述、checklist、附件與阻塞原因。
- 上限：看板 50（`boardsTruncated`）、bars 2000（`barsTruncated`）、unscheduled 200
  （`unscheduledTruncated`）。三者都有對應旗標——日曆的 `MAX_SCHEDULED` 沒有旗標，已列
  NextTasks 待補，本功能不重複該錯誤。

### 4.1 查詢實作與驗證關卡

卡片與 window 都藏在 `boards.data` 的 JSON blob 裡，因此用雙層 `json_each` 在 SQL 層展開：
外層展開 `$.cards`，內層展開該卡的 `$.assignmentWindows`。

兩層都必須加 `type = 'object'` 守門。這不是防禦性潔癖：`json_extract` 遇到非物件成員會拋
`malformed JSON`，讓整份查詢 500，而寫入端只驗 `cards` 是物件、不驗每個成員。日曆的最終
審查就是抓到這個——單層漏守門時，任何 contributor 都能讓全 workspace 管理者的日曆每次
請求 500，且從回應無從辨認毒源看板。

另須注意 D1 單一查詢 bind 參數上限 100：`projectIds` 與 assignee 目錄查詢的 `IN` 清單都不得
無分批展開（日曆的同一問題已列 NextTasks P1）。本功能實作時直接分批或明確設上限。

`people` 由可見專案的 `project_members` 聯集取得（含全部專案角色：owner、member、viewer），
再 join `user_accounts` 取 `display_name`，`ORDER BY display_name COLLATE NOCASE, id` 保證
穩定排序。

已離開專案但指派仍保留的成員（`任務多人指派 v1.1` 刻意保留離開成員的指派）不在
`project_members` 內，卻仍有 bars。這些 `userId` 必須補進 `people`，否則他們的條子會沒有
對應的列而在畫面上消失。補進來的項目 `displayName` 取自 `user_accounts`（查不到時留空字串，
由畫面顯示「已離開 (短ID)」），並排在正式成員之後，以維持「還在專案裡的人」在上方。

## 5. 畫面

新路由 `#/resources?from=YYYY-MM-DD`，導覽列第三個管理者入口（沿用 `WorkspaceEntryNav` 的
`showCalendar` 拆分作法，新增獨立旗標）。入口可見性與日曆一致：workspace admin 與非 admin
的 Project owner 都看得到。

- 縱軸每列一人，含零負載者。橫軸為日期，預設 14 天，可前後移動。
- 列內用 lane packing 把重疊的條子垂直堆疊成子列，避免互相遮蔽。
- **過載標示**：同一人同一天有兩條以上時，該日在該人列上以樣式加文字雙區隔標示，不只靠
  顏色。文字必須是可讀的繁中（例如「2 項並行」）。
- 阻塞與加急沿用卡面既有的三態呈現原則：文字與樣式雙區隔。
- 側欄列出「未排期指派」，每筆顯示卡片標題、專案與該成員，讓管理者知道要補什麼。
- 已離開 workspace 的成員沿用 `CardItem.tsx` 的「已離開 (短ID)」格式。

### 5.1 桌面專用

與日曆相同：`< 900px` 顯示引導訊息而非破版時間軸，CSS 專責切換（`.resourceNarrowNotice`
恆在 DOM）。行動版排程留待後續評估。

### 5.2 純函式模組

`app/projects/resource-model.ts` 承載全部計算：

- `dayRange(from, to)`：產生日期軸。
- `packLanes(bars)`：同一人的條子做重疊分層，回傳每條所屬 lane index。
- `overloadedDays(bars)`：算出每人每日並行條數，> 1 為過載。
- `shiftRange(from, to, deltaDays)`：視窗位移。
- `barSpanInWindow(bar, from, to)`：把跨窗邊界的條子裁切成可繪製的格數。

React 元件沒有測試 harness，這個模組是本功能唯一的自動化行為防線，比照
`app/projects/calendar-model.ts` 的作法。所有邊界（跨窗裁切、單日條、完全重疊、
部分重疊、相鄰不重疊）都必須有測試。

## 6. 測試重點

- **權限**：非 owner 改 `assigneeUserIds` 或 `assignmentWindows` → 403；改其他欄位 → 200。
  **舊 board（無 `assignmentWindows` 鍵）的 member 編輯必須 200**（lockout 回歸測試）。
- **normalizeBoard 幂等**：含無效 window（孤兒 userId、壞日期、反向區間、重複 userId）的
  board 正規化兩次結果相同。
- **端點範圍**：admin 得全 workspace、Project owner 只得他 own 的、member 403、
  非成員 404、archived 專案與看板不出現、已完成卡不出現。
- **畸形資料**：`$.cards` 含 scalar 成員、`$.assignmentWindows` 含 scalar 成員、
  `$.assignmentWindows` 本身是 scalar → 皆回 200 且跳過該筆，不得 500。
- **窗與截斷**：`from > to` 400、窗長 32 天 400、看板 51 個 `boardsTruncated`、
  bars 2001 筆 `barsTruncated`、unscheduled 201 筆 `unscheduledTruncated`。
- **SQL 交叉比對**：同一份 fixture 用 JS 獨立過濾一次，與 SQL 結果比對，證明 SQL 條件正確。
- **純函式**：lane packing 與過載計算的全部邊界。
- **隱私**：回應不含描述、checklist、附件與阻塞原因（以 SECRET_MARKER 洩漏測試釘住）。

## 7. 本次不包含

- **甘特圖上直接拖拉調整期間**。v1 只在卡片面板填寫，甘特圖純檢視。下一階段實作，已列
  NextTasks P1，並記錄實作前必須先解的四件事（跨卡 revision 樂觀鎖、樂觀更新回滾、
  多裝置 LWW 誤操作風險、owner-only 權限在拖拉路徑同樣成立）。
- **工作量（小時／百分比／產能上限）**。v1 用「同日並行條數」當過載訊號。
- 任務層級的計畫期間、任務間依賴（前置／後置）、關鍵路徑。
- 行動版時間軸。
- 已完成工作的歷史負載回顧。
- 跨 workspace 聚合。

## 8. 驗收條件

- [ ] Project owner 在卡片面板可為每位指派人填起訖日；member 看到的是唯讀。
- [ ] 舊看板（無 `assignmentWindows`）的 member 編輯不會被 403 擋下。
- [ ] 非 owner 嘗試改指派或期間得到 403，Activity Log 記錄欄位變更但不含日期內容。
- [ ] workspace admin 的甘特圖含全 workspace 所有 active 專案；Project owner 只含他 own 的；
      member 與 viewer 開 `#/resources` 被導回「我的專案」，直接呼叫端點得 403。
- [ ] 同一張卡片同時出現在多位指派人的列上，各自使用自己的期間。
- [ ] 這段期間完全沒有條子的成員仍出現在人員軸上，顯示為空白列。
- [ ] 已離開專案但指派仍保留的成員仍有自己的列，標示為「已離開」並排在正式成員之後。
- [ ] 同一人同日兩條以上時有文字與樣式雙區隔的過載標示。
- [ ] 有指派、無期間的卡片出現在「未排期」側欄。
- [ ] 視窗前後移動更新 URL，且以 `#/resources?from=YYYY-MM-DD` 直接開啟可重載。
- [ ] 跨窗邊界的條子正確裁切，不溢出時間軸。
- [ ] 已完成卡、archived 專案與 archived 看板不出現。
- [ ] 畸形卡片或畸形 window 不會讓端點 500。
- [ ] 視窗縮到 900 px 以下顯示引導訊息而非破版時間軸。
- [ ] 九項品質關卡全綠（`pnpm test`、`worker:test`、`lint`、`typecheck`、`build`、
      `mobile:build`、`worker:types:check`、`sync:dry-run:staging`、`git diff --check`）。
