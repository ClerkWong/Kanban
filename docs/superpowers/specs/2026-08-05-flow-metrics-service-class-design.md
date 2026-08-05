# 流動度量與服務類別 v1 規格

- 日期：2026-08-05
- 狀態：設計已核准，未實作
- 前置規格：`2026-08-03-project-admin-owner-member-design.md`、`2026-07-30-multi-assignee-tasks-design.md`

## 1. 問題與目標

以看板方法（Kanban Method）六大實踐檢視現況，前兩項已相當完整：工作視覺化（動態欄位、
標籤、優先級、多人指派、阻塞標示）與 WIP 限制（每欄可設上限、超限警告不阻擋）。
真正的缺口在第三項「管理流動」：

- 卡片沒有欄位進入時間，因此無法計算 Cycle Time，也無法看出哪張卡卡住太久。
- 阻塞狀態雖有 `blockedAt`，但解除阻塞時該時長即遺失，無法累計或統計。
- 既有月報只計算每月完成數，是產出計數，不是流動回饋。
- 所有工作被同等對待，沒有服務類別，因此無法辨識加急工作是否失控。

本規格的目標是補上流動度量的資料基礎，並讓度量在卡面與報表兩處可見：

1. 卡片能回答「在這一欄待了多久」。
2. 已完成卡片能回答「從開工到完成花多久，其中多少時間在阻塞」。
3. 每張卡有明確的服務類別，加急工作受 WIP 上限節制。

度量從功能上線起累積，**不回填歷史**。Activity Log 雖記錄欄位變更，但回放重建欄位歷史
成本高且不可靠；舊卡在報表中標示為「無度量資料」。

## 2. 領域模型

Board schema 由 v6 升為 v7。

### 2.1 Card 新增欄位

```ts
export type ServiceClass = "standard" | "expedite" | "fixedDate" | "intangible";

type Card = {
  // existing fields...
  /** 進入目前欄位的時間。跨欄移動時更新；同欄重排不更新。 */
  columnEnteredAt: string;
  /** 首次離開第一欄的時間。只設定一次，移回第一欄不清除。 */
  startedAt: string | null;
  /** 已解除的阻塞累計毫秒數。不含目前正在進行中的阻塞。 */
  blockedMs: number;
  serviceClass: ServiceClass;
};
```

規則：

1. `columnEnteredAt`
   - `addCard` 時設為 `createdAt`。
   - `moveCard` 在來源欄與目標欄不同時更新為移動時間；同欄重排（含 `moveCardRelative`
     的 up/down）不更新。
   - 由 `normalizeBoard` 保證為合法 ISO 時間；無效值退回 `updatedAt`，再退回 `createdAt`。
2. `startedAt`
   - 定義為「離開第一欄」：`moveCard` 時若來源欄是 `board.columns[0]`、目標欄不是，
     且 `startedAt` 為 null，則設為移動時間。
   - `addCard` 若直接建立在非第一欄（含完成欄），`startedAt` 設為 `createdAt`。
   - 一旦設定就不再變更；移回第一欄、重開已完成卡片都不清除。這讓重工的卡片
     Cycle Time 會變長，符合流動觀點。
3. `blockedMs`
   - 解除阻塞時累加 `unblockTime − blockedAt`；`blockedAt` 無效時不累加。
   - 仍在阻塞中的時間不寫入 `blockedMs`，由報表在計算時即時加上（見 3.3）。
   - 上限 `100 * 365 * 24 * 3600 * 1000`（約 100 年），超出視為無效並由
     `normalizeBoard` 夾回上限，避免惡意或損壞的 payload 汙染統計。
4. `serviceClass`
   - 預設 `"standard"`；未知值由 `normalizeBoard` 退回 `"standard"`。
   - `"fixedDate"` 建議搭配截止日。未設截止日時在卡片詳情顯示提示文字，但**不阻擋**
     儲存，與既有 WIP 超限警告的哲學一致。

### 2.2 BoardState 新增設定

```ts
export type BoardSettings = {
  /** 卡片在同一欄停留天數達此值轉為警示樣式。 */
  agingWarnDays: number;
  /** 達此值轉為嚴重樣式。 */
  agingAlertDays: number;
  /** 整個 Board 允許同時存在的在製加急卡數量上限；null 表示不限。 */
  expediteWipLimit: number | null;
};

type BoardState = {
  // existing fields...
  settings: BoardSettings;
};
```

預設值為 `agingWarnDays: 3`、`agingAlertDays: 7`、`expediteWipLimit: 1`。

驗證：兩個天數皆夾在 1–365 的整數；若 `agingWarnDays >= agingAlertDays`，則將
`agingAlertDays` 調整為 `agingWarnDays + 1`（上限 365）。`expediteWipLimit` 為 null 或
夾在 1–99 的整數。門檻是 Board 層級單一設定，不做逐欄門檻。

### 2.3 加急卡的 canonical 順序不變量

加急卡必須醒目且優先處理，但若只在畫面上置頂、canonical `cardIds` 不動，拖放與上下移動
控制的行為就會與所見不符。因此把它定為 canonical 不變量，由 `normalizeBoard` 強制：

**在每個欄位的 `cardIds` 中，`serviceClass === "expedite"` 的卡片一律排在所有非加急卡之前，
兩個區段內部維持既有相對順序。**

衍生行為：

- 卡片改為加急時，移動到所在欄位加急區段的**最後**。
- 卡片解除加急時，移動到非加急區段的**最前**。
- 拖放或移動控制若把加急卡放進非加急區段（或反之），`normalizeBoard` 會拉回正確區段。
  介面需說明加急卡固定排在欄位前段，避免使用者誤判成拖放失效。
- 顯示順序等於 canonical 順序，因此既有拖放、鍵盤移動與「搜尋／篩選啟用時停用排序」
  的規則都不需改變。
- 同步 merge 後一律重跑 `normalizeBoard`，不變量在合併結果上恢復。

### 2.4 篩選器新增維度

```ts
type Filters = {
  // existing fields...
  serviceClass: "all" | ServiceClass;
};
```

沿用既有的跨群組 AND 語意。

## 3. 度量定義

所有度量由已持久化的卡片欄位直接計算，**不需每日快照**。

### 3.1 卡片老化（Aging WIP）

- 定義為 `columnEnteredAt` 的本地日曆日與今日本地日曆日的天數差，與逾期判定同樣採
  date-only 比較，不把時間值轉成 UTC 瞬間。
- 只在非完成欄顯示；完成欄的卡片不顯示老化。
- 天數 `>= agingAlertDays` 為嚴重、`>= agingWarnDays` 為警示、其餘為正常。

### 3.2 Cycle Time

- `completedAt − startedAt`，只在兩者皆存在時計算。
- `startedAt` 為 null 的已完成卡片（舊資料，或建卡即拖進完成欄之前的歷史卡）計入
  「無度量資料」計數，不計入平均與中位數。
- 以天為單位顯示，取一位小數。
- 沿用既有行為：卡片移出完成欄時 `completedAt` 會清為 null，因此該卡會離開報表；
  再次完成時以新的 `completedAt` 落到新的月份，而 `startedAt` 不變，Cycle Time 因此
  包含重工時間。

### 3.3 阻塞時長與流動效率

- 卡片的阻塞總時長 = `blockedMs` + 進行中阻塞時長。
- 進行中阻塞時長：卡片 `blocked` 為 true 且 `blockedAt` 合法時，
  等於 `min(now, completedAt ?? now) − blockedAt`；否則為 0。
  已完成但仍標記阻塞的卡片，只計到 `completedAt`。
- 流動效率 = `(cycleTime − 阻塞總時長) / cycleTime`，夾在 0–1。
  `cycleTime` 為 0 或無值時不計算該卡。

### 3.4 服務類別分佈

依 `serviceClass` 統計每月完成數。加急佔比過高是典型的流動異味，這個分佈是讓它可被看見。

## 4. 使用者介面

### 4.1 卡面

- 非完成欄的卡片顯示「此欄 N 天」；達門檻時同時改變樣式**並**變更文字（例如
  「此欄 8 天 · 停留過久」）。顏色不是唯一資訊載體，並提供 AT 可讀的敘述，
  延續既有 WCAG AA 與「狀態不以顏色單獨表達」的準則。
- 服務類別非 `standard` 時顯示小徽章（加急／固定日期／無形），加急另加明顯邊框。
- 觸控目標仍維持至少 44 × 44 CSS px；新增徽章屬於非互動顯示元素，不佔用操作區。

### 4.2 卡片詳情

- 新增「服務類別」選擇；`fixedDate` 未設截止日時顯示非阻擋提示。
- 顯示唯讀的「此欄停留」與（已完成時）「Cycle Time」「阻塞時長」。

### 4.3 看板頂部

- 既有統計列（總數、進行中、已完成、逾期）新增「加急 N/上限」。
- 加急計數只含**非完成欄**的加急卡，並且和欄位 WIP 一樣由完整、未篩選的卡片狀態計算，
  不受目前搜尋或篩選影響。
- 加急卡數超過 `expediteWipLimit` 時警告但不阻擋建立或標記，與欄位 WIP 一致。

### 4.4 流動報表

擴充既有 `MonthlyReportModal` 為「流動報表」，維持最近六個日曆月（含零資料月份）：

| 區塊 | 內容 |
| --- | --- |
| 完成數 | 既有每月完成數 |
| Cycle Time | 中位數與平均（天），另列「無度量資料」卡數 |
| 阻塞 | 每月阻塞總時長，與流動效率中位數 |
| 服務類別 | 每月各類別完成數 |

報表不顯示卡片描述與附件內容，延續既有隱私準則。

## 5. 權限

- Board 設定（老化門檻、加急 WIP 上限）：與工作流欄位管理同一道權限閘，
  只有 Project owner 可修改。
- 卡片 `serviceClass`：owner 與 member 可修改，與既有卡片編輯權一致。
- legacy viewer 與封存 Board：全部唯讀，包含 Board 設定與服務類別。
- 離線時的 Board 設定變更沿用既有「離線管理操作不進 queue」規則。

## 6. 同步與稽核

- 新欄位隨 BoardState 走既有 per-Board revision、離線儲存與卡片級 LWW，
  不新增 API 端點，也不建 D1 join table。
- `blockedMs` 在併發編輯下取最後寫入者的值，可能少算一段阻塞時間。這是刻意接受的
  精度損失，換取合併邏輯不變。此限制須寫入 README 的已知限制。
- Worker 端 `boards.ts` 驗證：`serviceClass` 必須是四個列舉值之一；
  `columnEnteredAt` 必須是合法 ISO 字串；`startedAt` 為 null 或合法 ISO 字串；
  `blockedMs` 為有限、非負且不超過上限的數字。不合法的 payload 以既有錯誤 envelope 拒絕。
- Worker `board-diff.ts` 只把 `serviceClass` 加入 Activity Log 追蹤欄位。
  `columnEnteredAt`、`startedAt` 與 `blockedMs` 是移動與阻塞操作的衍生時間戳，
  記入 Log 只會製造雜訊，明確排除。
- Worker `reports.ts` 的六個月 summary 擴充為包含流動度量，計算規則與 client 一致，
  仍不回傳卡片內容。

## 7. Migration

v6 → v7：

- `columnEnteredAt` 設為 `updatedAt`，無效時退回 `createdAt`。這是最佳可得近似值，
  會讓上線當下的在製卡片老化天數從最後編輯時間起算。
- `startedAt` 一律設為 null，即使卡片已在後段欄位。用 `createdAt` 反推會產生誤導的
  Cycle Time；寧可標示「無度量資料」。
- `blockedMs` 設為 0。上線前既有的阻塞時長不追溯。
- `serviceClass` 設為 `"standard"`。
- `BoardState.settings` 補上預設值。
- 沿用 v5 的既有保證：`completedAt` **不得**因 migration 被重算。
- v1–v5 的讀取路徑同樣補上以上預設值，既有 v6 之前的 migration 行為不變。

## 8. 測試重點

- Migration：v6→v7 與 v1–v5 讀取都補齊新欄位，且 `completedAt` 不變。
- `columnEnteredAt`：跨欄移動更新、同欄重排不更新、`moveCardRelative` 的 up/down 不更新。
- `startedAt`：首次離開第一欄設定一次；再次移動不覆寫；移回第一欄不清除；
  直接建立在非第一欄時於建卡時設定。
- `blockedMs`：多次 block／unblock 循環的累計正確；無效 `blockedAt` 不累加；超上限被夾回。
- 加急不變量：標記／解除加急後區段位置正確；拖放進錯區段會被拉回；
  merge 後不變量恢復；欄位內無重複 card ID。
- 度量計算：進行中阻塞的即時加總；已完成仍阻塞只計到 `completedAt`；
  流動效率夾在 0–1；`startedAt` 為 null 計入「無度量資料」。
- 報表：零資料月份、Asia/Taipei 的 UTC 月界線、archived Board 預設排除，
  以及 client 與 Worker 計算結果一致。
- 權限：member 不能改 Board 設定；viewer 與 archived Board 全唯讀；Worker 同步強制。
- Worker 驗證：不合法 `serviceClass`、時間戳與 `blockedMs` 被拒絕，且不影響既有欄位驗證。

## 9. 本階段不包含

- 泳道檢視（依服務類別分列）。已決定留待度量基礎穩定後再評估。
- 累積流圖（CFD）與每日快照資料表。
- 逐欄老化門檻、逐欄服務類別政策。
- 明確承諾點（commitment point）欄位標記與 Lead Time（建卡起算）。
- Cycle Time 85 百分位與交付預測；六個月月度分桶樣本量太小，先只給中位數與平均。
- 欄位政策外顯（拉入／離開條件文字）。
- 跨 Project 的流動度量彙總。
- 老化或阻塞逾時的通知與推播。

## 10. 驗收條件

- [ ] Card schema v7 的四個新欄位在儲存、重載、同步後不遺失。
- [ ] 舊 v1–v6 資料升級後 `completedAt` 未被重算，且報表正確標示「無度量資料」。
- [ ] 跨欄移動更新 `columnEnteredAt`，同欄重排不更新。
- [ ] `startedAt` 在首次離開第一欄時設定，之後任何移動都不改變。
- [ ] 多次阻塞／解除後 `blockedMs` 累計正確；仍在阻塞中的卡片報表即時反映。
- [ ] 非完成欄卡片顯示停留天數，達門檻時同時變更樣式與文字。
- [ ] 加急卡在 canonical 順序上恆排於欄位前段；拖放、鍵盤移動與同步 merge 後不變量成立。
- [ ] 加急計數只含非完成欄的卡片，且由未篩選狀態計算；超過上限時警告但不阻擋。
- [ ] 服務類別篩選與既有篩選群組維持 AND 語意。
- [ ] 流動報表顯示每月完成數、Cycle Time、阻塞時長、流動效率與服務類別分佈，
      且含零資料月份。
- [ ] client 與 Worker 的六個月流動度量結果一致。
- [ ] 只有 owner 能修改 Board 設定；member 可改服務類別；viewer 與 archived 唯讀。
- [ ] Worker 拒絕不合法的 `serviceClass`、時間戳與 `blockedMs`。
- [ ] Activity Log 記錄 `serviceClass` 變更，且不含衍生時間戳雜訊。
- [ ] 單元測試、Worker runtime tests、lint、typecheck、Web 與 mobile build 全綠。
