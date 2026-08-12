# 跨專案日曆檢視 v1 規格

- 日期：2026-08-12
- 狀態：設計已核准，未實作
- 前置：多看板與看板指派 v1（`665077b`）已合入 main 並部署 staging

## 1. 問題與目標

管理者需要在月初或每週回答一個問題：**這個月剩下的時間，我還能推動哪些事，可以派給誰。**
現有介面回答不了——看板是單板視角、流動報表回顧已完成的工作，兩者都沒有「跨專案的
時間軸與人力負擔」視圖。

v1 的目標是建立**資源 awareness**：管理者一眼看到本月已排定的工作分布、誰的負擔集中
在哪幾天、還有哪些未排程或未指派的任務可以推進。

決策記錄（2026-08-12 與使用者確認）：

| 決策 | 選擇 |
| --- | --- |
| 時間軸依據 | 現有 `dueDate`；不新增排定日期欄位（零 schema 變更） |
| 度量 | 只顯示**任務件數**；工作量／工時估計留待下一階段（需先累積不同任務類型的實際資料） |
| 聚合範圍 | 跨專案、跨看板 |
| 可用身分 | 只給管理者；workspace admin 的邊界為此放寬（見 §2） |
| 寫入 | v1 純檢視；是否要在日曆上改指派人，待實際使用後觀察 |
| 主軸 | 日期為主軸；執行者主軸視圖列為下一階段 |
| 「計劃」的定義 | Project 層級，但只作為卡片的標籤與篩選維度，不做專案層級樹狀彙總 |
| 行動版 | v1 桌面專用；窄視窗顯示引導訊息（這是管理工具） |

## 2. 權限與邊界放寬

| 身分 | 日曆可見範圍 |
| --- | --- |
| Workspace owner／admin | 整個 workspace 的所有 active 專案 |
| Project owner（D1 `manager`） | 他擔任 owner 的 active 專案 |
| Project member（`contributor`）／legacy viewer | 無此檢視，回 **403** |
| 未登入／無效 session | 401 |

### 2.1 這是一次刻意的邊界放寬

多看板規格 §2.3 曾確認「workspace admin 未加入 Project 時不可讀工作內容（維持現狀）」。
本規格**推翻該規則的一部分**：workspace admin 透過日曆端點可讀到卡片標題、截止日、
指派人與專案／看板名稱。

放寬**限定在日曆端點本身**，既有端點一律不變：board content、附件、Activity Log
仍然需要加入專案才能讀取。理由是管理者要的是資源 awareness，不需要完整工作內容與
稽核紀錄；把放寬鎖在單一端點，日後要收回也只需改一處。

### 2.2 與看板指派可見性的關係

日曆是管理者專屬，而 Project owner 恆可見專案內所有看板、workspace admin 在本端點
可見全部——因此**不需要套用 `resolveVisibleBoardIds`**。member 拿不到這個端點，
不存在「member 透過日曆繞過看板指派」的路徑。這一點必須有測試覆蓋。

## 3. 資料來源與端點

`GET /calendar?month=YYYY-MM`

`month` 必填，格式須為 `YYYY-MM`，不合法回 400 `invalid_month`。月份邊界以
**Asia/Taipei** 計算，與既有報表同一時區常數。

回傳：

```jsonc
{
  "month": "2026-08",
  "scope": "workspace" | "owned_projects",
  "scheduled": [
    {
      "cardId": "...", "title": "...", "dueDate": "2026-08-14",
      "assigneeUserIds": ["..."],
      "projectId": "...", "projectName": "...",
      "boardId": "...", "boardName": "...",
      "blocked": true, "serviceClass": "expedite"
    }
  ],
  "unscheduled": [ /* 同上，dueDate 為空字串 */ ],
  "unscheduledTruncated": false,
  "assignees": [{ "userId": "...", "displayName": "..." }],
  "requestId": "..."
}
```

規則：

1. **只含未完成卡**：`completedAt` 為 null。已完成的工作屬於流動報表的守備範圍。
2. `scheduled`：`dueDate` 落在該月（含當月第一天與最後一天）的卡片。
3. `unscheduled`：`dueDate` 為空的卡片，上限 **200** 筆，超出時 `unscheduledTruncated`
   為 true。上限存在的理由是未排程池可能很大而它只是候選清單，不需要完整。
4. 只含 active 專案的 active 看板；archived 專案與 archived 看板一律排除（封存的工作
   不會被推進）。
5. `assignees` 只含在本次回傳卡片中出現過的 userId，附 `display_name`；已離開 workspace
   的 userId 若無法解析則不出現在目錄中（client 以短 ID 呈現，沿用既有慣例）。
6. 不回傳卡片描述、checklist、附件與阻塞原因——日曆不需要，且降低放寬邊界的暴露面。

### 3.1 查詢實作與驗證關卡

卡片存在 `boards.data` 的 JSON blob 中（單板上限 1 MiB）。既有
`buildProjectSummary` 的做法是把整份 board JSON 拉進 Worker 解析；跨專案聚合若照抄，
20 個看板可能拉進 20 MB，慢且浪費記憶體。

**做法**：以 SQLite 的 `json_each`／`json_extract` 在 SQL 層展開卡片並過濾月份與
完成狀態，只回傳需要的欄位。

**已實測確認（2026-08-12，remote staging D1）**：原先此處標為「必須驗證的設計假設」，
現已有實證，不再是假設。在 staging D1 上對 `boards.data` 執行

```sql
SELECT json_extract(c.value, '$.title') FROM boards b, json_each(json_extract(b.data, '$.cards')) c
WHERE b.id = ?
```

成功展開並過濾，16 張卡片查詢 `sql_duration_ms` 為 **2.6 ms**；同樣手法也用於展開
`$.columns`（0.54 ms）。因此 D1 支援 `json_each` 對 board JSON 的展開，效能足夠，
**採用 SQL 層過濾，不需要保守做法**。

保留的保守上限：即使走 SQL 層過濾，仍對單次請求設 **50 個看板**上限，超出時回應加上
`boardsTruncated` 旗標並在 UI 明示，不得靜默截斷。這是防止 workspace 規模成長後
單一請求無界擴張的護欄，與查詢方式無關。

## 4. 畫面

新頂層路由 `#/calendar`（可選 `?month=YYYY-MM`），與「我的專案」同層。入口只對
管理者顯示，沿用既有 `admin` 路由的 `allowAdmin` gating 模式（`resolveAuthorizedRoute`
對無權身分導回 `#/projects`）。

- **月曆格子**：7 欄 × 最多 6 列。每格顯示當天卡片（標題、指派人、專案名），格右上顯示
  當日件數。今天的格子明顯標示。
- **視覺區隔**（都必須同時有文字或 aria 標示，不可只靠顏色，沿用既有 WCAG 準則）：
  - 阻塞卡：給它時間也推不動，需與一般卡明顯不同。
  - 逾期卡（`dueDate` < 今天且未完成）：要先處理才談新工作。
  - 加急卡（`serviceClass` 為 `expedite`）：沿用看板既有的加急徽章樣式。
- **側欄**：
  - **未排程池**：可依專案與指派人篩選；`unscheduledTruncated` 為 true 時明示「僅顯示前 200 筆」。
  - **每人本月件數**：每位指派人的本月卡數，另列**未指派卡數**——那是最直接的
    「還可以派給誰」線索。
- **月份切換**：上月／下月／回本月；切換時更新 URL 的 `month` 參數，可分享與可重載。
- **空狀態**：本月無任何卡片時說明「本月沒有排定的任務」並引導看未排程池。

### 4.1 行動版

v1 桌面專用。視窗寬度小於 **900 px** 時不渲染月曆，改顯示引導訊息
「日曆檢視需要較寬的畫面，請在桌面瀏覽器使用。」以 CSS media query 判斷寬度而非
平台偵測——這樣原生 App 與手機瀏覽器都會得到同一結果。

## 5. 測試重點

- 權限：workspace admin 得到全 workspace 範圍；project owner 只得到他 own 的專案；
  member 與 viewer 回 403；無 token 回 401。
- **member 不能透過日曆繞過看板指派可見性**（明確測試，這是新端點最重要的安全斷言）。
- 範圍：archived 專案與 archived 看板的卡片不出現；已完成卡不出現。
- 月份邊界：以 Asia/Taipei 計算；月初與月末當天的卡片包含在內；`YYYY-MM` 以外格式回 400。
- 未排程：`dueDate` 為空的卡片進入 `unscheduled`；超過 200 筆時 `unscheduledTruncated`
  為 true 且不靜默截斷。
- 回應不含卡片描述、checklist、附件與阻塞原因。
- SQL 層過濾的正確性：`json_each` 展開後的月份與完成狀態過濾結果，與「Worker 內解析
  同一份 board JSON」的結果一致（以同一組 fixture 交叉比對，防止 SQL 條件寫錯而靜默漏卡）。
- 測試使用動態日期或明確注入的月份，不得硬編當月字串——沿用先前修掉時間炸彈的教訓。

## 6. 本次不包含

- 執行者主軸視圖（每列一人、橫軸日期）——下一階段，使用者已明確要求。
- 工作量／工時估計與產能上限——需先累積不同任務類型的實際工時資料。
- 拖放改期、在日曆上改指派人——待實際使用觀察後再定。
- 週檢視、日檢視。
- 跨 workspace 聚合。
- 以流動度量的 Cycle Time 中位數預測「本月做得完嗎」。
- 行動版月曆版面。
- 日曆事件的 iCal 匯出或外部日曆整合。

## 7. 驗收條件

- [ ] workspace admin 可看到全 workspace 所有 active 專案的本月卡片。
- [ ] project owner 只看到他 own 的專案；member 與 viewer 得到 403。
- [ ] member 無法透過日曆端點取得未被指派看板的卡片資訊。
- [ ] 月曆正確依 `dueDate` 分格；逾期、阻塞與加急卡有文字與樣式雙重區隔。
- [ ] 未排程池顯示 `dueDate` 為空的卡片，超過 200 筆時明示已截斷。
- [ ] 側欄顯示每人本月件數與未指派卡數。
- [ ] 月份切換更新 URL 且可直接以 URL 重載指定月份。
- [ ] 已完成卡、archived 專案與 archived 看板的卡片不出現。
- [ ] 視窗寬度小於 900 px 時顯示引導訊息而非破版月曆。
- [ ] SQL 層過濾結果與 Worker 內解析的交叉比對一致；超過 50 個看板時 `boardsTruncated` 為 true 且 UI 明示。
- [ ] `pnpm test`、`pnpm worker:test`、lint、typecheck、Web／mobile build 全綠。
