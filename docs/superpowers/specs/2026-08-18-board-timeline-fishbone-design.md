# 看板時間軸魚骨圖 v1 規格

- 日期：2026-08-18
- 狀態：已核准方向，待實作計畫
- 前置：人力甘特圖 v1（`docs/superpowers/specs/2026-08-13-resource-gantt-design.md`）

## 1. 問題與目標

日曆檢視回答「這個月有哪些任務要推進」，人力甘特圖回答「這段期間誰有空、誰被排爆」。
兩者都回答不了「這個看板的任務是**何時真正動起來**的」。

本功能在單一看板上提供一張魚骨圖：水平主骨是時間軸，任務以**實際開工日**為接點從軸上
長出、上下交錯；子任務以虛線連到上層任務，但位置仍是它自己的開工日。管理者從這張圖看出
任務的啟動節奏，以及任務與時間的對應關係。

目標決策：哪些工作已經動起來、動起來的節奏是疏是密、還有哪些排了卻完全沒動。

### 1.1 「開工」的定義與其落差

接點取 `Card.startedAt`——「首次離開第一欄的時間，只設定一次，移回第一欄不清除」。
這是系統裡唯一具有「實際開工」語意的欄位，不需要新資料。

**必須明白記錄的落差**：這等於「卡片被移出待辦欄」。若團隊習慣是卡片建立後很久才移動，
圖上的啟動時點會比真實開工晚。這是既有欄位的語意，本功能不改它，也不另建一個「開工日」
欄位——多一個需要人工維護的日期，只會產生第二種不準。

`startedAt` 為空的卡片沒有接點，收在主骨左端的「未啟動」池（作法與日曆的未排程池、
甘特圖的未排期側欄一致）。

`startedAt` 是完整的 ISO 時間戳，而排版是以「日」為單位。轉換規則：**以檢視者的本地時區
取出日期**，得到 `YYYY-MM-DD` 字串後，其餘運算全部走 UTC 的字串／天數算術。理由是管理者
讀的是自己日曆上的「哪一天開工」，這也與看板既有的逾期與今天標示同一個慣例。時區選錯會讓
卡片整體偏移一天，因此這條轉換必須有跨時區測試。

## 2. 資料模型（Card schema v9）

`Card` 新增一個欄位：

```ts
/** 上層任務的卡片 id；null 表示直接掛在時間軸上。
 *  純結構分解，不影響任何狀態計算。 */
parentCardId: string | null;
```

```ts
/** 卡片層級上限：頂層為第 1 層，其下最多再兩層。 */
export const MAX_CARD_DEPTH = 3;
```

### 2.1 不做狀態上捲

這是本功能的核心約束：**父子關係與任務狀態完全無關。**

- 父卡的完成與子卡無關。子任務沒有完成，父任務也可能已經達到目標。
- WIP 計算、完成欄語意、欄位停留老化、Cycle Time、阻塞時長、加急排序——全部各卡各算，
  不因父子關係改變任何一項。
- **不提供「子樹完成 N/M」之類的聚合計數。** 這種數字會誘導使用者把父卡讀成子卡的總和，
  正好違反上面的原則。卡面上的 `N/M` 只來自該卡自己的 checklist。

### 2.2 `normalizeBoard` 的四種壞資料

`normalizeCardHierarchy` 處理下列情形，且必須幂等：

1. `parentCardId` 指向不存在的卡片（含已刪除、已 tombstone）→ 清為 `null`。
2. 指向自己 → 清為 `null`。
3. 成環（A→B→A，或更長的環）→ 斷開環。為了決定性，卡片 id 以字典序走訪，
   把「造成環閉合」的那一張的 `parentCardId` 清為 `null`。
4. 深度超過 `MAX_CARD_DEPTH` → 該卡降為頂層（`parentCardId` 清為 `null`），
   而非整條鏈重排。

`assertBoardInvariants` 另外斷言：不存在環、不存在指向不存在卡片的
`parentCardId`、任一卡片深度不超過 `MAX_CARD_DEPTH`。

### 2.3 刪除父卡

`deleteCard` 在移除卡片時，把所有 `parentCardId` 指向它的卡片清為 `null`——子卡升為頂層，
不連帶刪除。理由是子任務的存在與狀態不依賴父任務，父卡消失不該抹掉子卡的工作。
tombstone 行為不變。

### 2.4 Migration 與合併

v8 → v9 一律補 `parentCardId: null`，不替舊卡推導任何關係。

`parentCardId` 隨卡片整體 LWW 合併，不做特別處理。兩台裝置同時改同一張卡的上層任務時，
後寫入者勝。合併後 `normalizeBoard` 會再跑一次 §2.2，所以跨裝置合併不可能產生環——
這點須有測試釘住。

## 3. Worker 驗證與權限

### 3.1 結構驗證

`requireValidCardHierarchy`：**`parentCardId` 缺席即通過**，出現才驗格式。

- 不是字串也不是 `null` → 400 `invalid_card_hierarchy`
- 是字串但指向同一份 board 內不存在的卡片 → 400
- 指向自己 → 400
- 成環 → 400
- 深度超過 `MAX_CARD_DEPTH` → 400

正常使用下這些 400 不可達：客戶端在送出前必經 `normalizeBoard`（§2.2），環與孤兒都已被
清掉。這道驗證守的是繞過客戶端的直接請求與歷史壞資料。

「缺席即通過」不是可有可無：v9 客戶端一律送 `parentCardId: null`，而現存所有 board 的
卡片都沒有這個鍵。若把缺席當成違規，舊看板的任何編輯都會 400。這是流動度量 v7 的
absent-settings lockout 與人力甘特圖 v8 的 absent-`assignmentWindows` 同型錯誤，
不接受第三次。

### 3.2 權限：member 可改

`parentCardId` 是工作內容的組織方式，與 checklist、標籤同一層，**不是**「分派任務」。
因此它跟卡片其他欄位一樣，`contributor` 可以修改。

**`parentCardId` 絕對不可加入 `assignmentSignature`。** 指派名單與投入期間的 owner-only
收斂只涵蓋 `assigneeUserIds` 與 `assignmentWindows`；把層級欄位混進那個簽章會讓 member
一改上層任務就被 403。須有「member 改 `parentCardId` 得 200」的測試釘住這條界線。

### 3.3 Activity Log

`board-diff.ts` 的 `CardField` 新增 `parentCardId`，只記欄位名稱變更，不記 id 內容——
沿用既有慣例。

## 4. 畫面

### 4.1 路由與入口

新增路由 `#/projects/:projectId/boards/:boardId/timeline`，入口是看板頁上的檢視切換
（看板／魚骨圖）。狀態放在 URL，可分享、可重載，與既有路由慣例一致。

可見性完全沿用看板既有規則：能看到這張看板的人就能看到它的魚骨圖，包含依看板指派而
可見的 member。**不新增任何權限放寬，也不新增 Worker 端點**——資料就是客戶端已載入的
board。

### 4.2 版面

- 水平主骨為時間軸，左端是起點標記，軸上標注日期刻度。
- 已開工卡片（`startedAt` 非空）依 `startedAt` 定位於主骨上，上下兩側交錯。
- **子卡與父卡同側**，以虛線連到父卡，避免連線跨越主骨。子卡位置仍是它自己的
  `startedAt`；連線只表示歸屬，不表示時間關係。
- 同一日期多張卡片時向外堆疊（同側多列），作法比照甘特圖的 lane packing。
- 未啟動池固定在主骨左端，列出 `startedAt` 為空的卡片，不佔時間軸位置。
- 卡面顯示：標題、該卡自己的 checklist 進度（`3/6`，無 checklist 時不顯示）、
  日期標籤、受阻與加急徽章。阻塞與加急沿用既有的文字加樣式雙區隔原則。
- **不做「成果」徽章。** 系統沒有對應概念，硬湊會變成假資訊。
- 縮放為離散級距的每日像素寬：`8`、`12`、`16`、`24`、`32` px/日，預設 `16`。另有全螢幕。

### 4.2.1 上層任務的設定

父子關係在卡片編輯面板設定，不在魚骨圖上。面板提供一個「上層任務」選單，**選項已排除
不合法的目標**：自己、自己的全部子孫（避免成環）、以及選了會讓自身子樹超過
`MAX_CARD_DEPTH` 的卡片。這樣使用者不會選到一個必然被 Worker 以 400 擋下的值。

選單以卡片標題呈現，同標題時附短 id 區分。清空選項代表「直接掛在時間軸上」。

### 4.3 桌面專用

`< 900px` 顯示引導訊息而非破版時間軸，由 CSS 專責切換、通知元素恆在 DOM——與日曆及
甘特圖同一套機制、同一個斷點。

### 4.4 上限

單一看板的卡片數已受 `MAX_BOARD_BYTES`（1 MB）與工作流欄位上限約束，因此本功能不另設
卡片數上限。但版面計算必須在數百張卡的規模下不卡頓：`timeline-model` 的排版一次計算完成，
不在渲染迴圈裡重算。

## 5. 純函式模組

`app/projects/timeline-model.ts` 承載全部計算：

- `timelineBounds(cards, today)`：回傳 `{ from, to }`，`from` 取最早的 `startedAt`
  日期，`to` 取 `max(今天, 最晚 startedAt)`；沒有任何已開工卡片時回 `null`。
- `buildForest(cards)`：由 `parentCardId` 建出樹狀結構，回傳頂層卡片與每張卡的子卡清單。
  即使輸入含環或孤兒也不得無限遞迴或拋錯（board-model 已正規化，但這個模組不假設）。
- `layoutTimeline(cards, bounds, pxPerDay)`：回傳每張已開工卡片的
  `{ cardId, x, side, row }`；子卡與父卡同側，同日期向外堆疊。
- `unstartedCards(cards)`：`startedAt` 為空的卡片，依 `createdAt` 再 `id` 排序。
- `dayOffset(from, day)`：兩個 date-only 字串相距的天數，走 UTC 運算。

React 元件沒有測試 harness，這個模組是本功能唯一的自動化行為防線，比照
`app/projects/calendar-model.ts` 與 `app/projects/resource-model.ts` 的定位。所有邊界
（空看板、單張卡、全部未開工、同日大量卡片、深度 3、跨月跨年跨閏日）都要有測試。

## 6. 測試重點

- **`normalizeBoard` 幂等**：含孤兒、自我指向、環（兩張與三張）、超深度的 board
  正規化兩次結果相同。
- **`assertBoardInvariants`**：對含環或超深度的 board 拋錯。
- **`deleteCard`**：刪除父卡後子卡的 `parentCardId` 為 `null`，子卡本身仍在。
- **合併**：兩份 board 各自合法但合併後會成環的情形，合併結果無環。
- **Worker lockout 回歸**：舊 board（卡片無 `parentCardId` 鍵）的 member 編輯得 200。
- **Worker 權限界線**：member 改 `parentCardId` 得 200（證明它不在
  `assignmentSignature` 內）；member 改 `assigneeUserIds` 仍得 403。
- **Worker 結構驗證**：非字串非 null、指向不存在卡片、指向自己、成環、超深度各得 400。
- **純函式**：`layoutTimeline` 的子卡同側、同日堆疊、`timelineBounds` 的空看板與單卡、
  `buildForest` 對環的容忍、`dayOffset` 在三個極端時區下結果一致。
- **視窗縮到 900px 以下顯示引導訊息。**

## 7. 本次不包含

- 跨看板與跨專案聚合。一張魚骨圖只畫一張看板。
- 狀態上捲、子樹聚合計數。
- 任務依賴（前置／後置）與關鍵路徑。
- 在魚骨圖上直接編輯（拖拉改開工日、拉線改父子）。v1 純檢視，父子關係在卡片面板設定。
- 「成果」徽章。
- 行動版時間軸。
- 新的「開工日」欄位；接點一律取既有的 `startedAt`。

## 8. 驗收條件

- [ ] 卡片面板可設定上層任務；member 也能設定（不被 403 擋下）。
- [ ] 上層任務選單不列出自己、自己的子孫、以及會超過深度上限的卡片。
- [ ] 舊看板（卡片無 `parentCardId`）的 member 編輯不會被 403 擋下。
- [ ] 選不到會成環的上層任務，或選了會被 Worker 以 400 擋下且畫面有可讀訊息。
- [ ] 刪除父卡後，子卡仍在且升為頂層（在魚骨圖上直接接到主骨）。
- [ ] 已開工卡片依 `startedAt` 定位在主骨上，位置與日期刻度相符。
- [ ] 子卡與父卡同側，虛線連到父卡，且子卡位置是它自己的 `startedAt`。
- [ ] 同一天多張卡片向外堆疊，不互相遮蔽。
- [ ] `startedAt` 為空的卡片出現在主骨左端的未啟動池，且不佔時間軸位置。
- [ ] 卡面的 `N/M` 只反映該卡自己的 checklist，不含子卡。
- [ ] 受阻與加急有文字加樣式的雙區隔。
- [ ] 縮放與全螢幕可用；縮放後卡片位置與日期刻度仍相符。
- [ ] 父卡完成、子卡未完成時，父卡在看板與魚骨圖上都顯示為完成（狀態不上捲）。
- [ ] 視窗縮到 900 px 以下顯示引導訊息而非破版時間軸。
- [ ] 九項品質關卡全綠（`pnpm test`、`worker:test`、`lint`、`typecheck`、`build`、
      `mobile:build`、`worker:types:check`、`sync:dry-run:staging`、`git diff --check`）。
