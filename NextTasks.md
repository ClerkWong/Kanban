# Kanban 後續任務與發布 Runbook

- 最後更新：2026-08-05
- 目前分支：`codex/platform-admin-user-entry`
- 最新已推送應用候選：`2bd8506`（Web Beta v15；iOS／Android `1.1.0 (5)`）
- `main` 已整合多專案 v1：`d54e0ec`

本文件整併先前兩份規劃，是後續工作、驗收與發布順序的單一依據。
已完成的歷史實作只保留結果與證據；未完成項目依實際執行順序排列。

## 目前真實狀態

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| 單一專案看板與 admin/owner/member | 已完成並發布 Beta v15 | Project 建立會同時建立唯一 Board 與初始 owner；member 可編輯任務；legacy viewer 僅唯讀；staging Worker 與 private Sites Beta 已更新 |
| 登入與使用者管理 | 已發布 Beta，待完整多角色驗收 | email/password session、登入限制、平台帳號建立／停用／角色／密碼重設、同 Workspace 使用者選單已發布；production 不變更 |
| 多專案 v1 合併 main | 已完成並推送 | `feature/multi-project-v1` 已於 `d54e0ec` 合併至 `main` |
| 平台管理者／一般使用者入口 | 第一階段已完成並發布 Beta | 一般使用者預設進「我的專案」；Workspace owner/admin 才可見平台管理入口、metadata registry 與建立專案功能 |
| 月報資料模型 | 已完成 | 以 `completedAt` 計算最近六個日曆月；schema v4 可遷移 v1/v2/v3 |
| 3b 附件用戶端 | 多看板同步層與 UI 已完成 | queue v2、下載與 R2 endpoint 已按 user/Project/Board/Attachment 隔離 |
| Worker 3b | 多專案後端已部署 staging | identity、ACL、Project/Board API、summary、Activity Log 與 scoped R2 API 已部署到隔離 staging；production 尚未部署 |
| 多專案規格 | 已核准並收斂為單專案單看板 | 2026-07-24 多看板規格保留為歷史基礎；現行產品規則是每個 Project 一個主要 Board，名稱仍可不同 |
| 多專案 Milestone A | 已完成並推送 | Project domain／ACL capability、per-board storage 與可恢復 legacy migration |
| 多專案 Worker Task 3 | 已完成並推送 | additive D1 schema、append-only Activity Log constraints、個人／legacy token bootstrap；未套用遠端 |
| 多專案 Worker Task 4 | 已完成並推送 | HTTP/router、個人 identity、Project ACL、audit foundation；legacy API 保持相容 |
| 多專案 Worker Task 5 | 已完成並推送 | `/me`、Project lifecycle、membership 與 admin registry APIs；具備 last-owner guard（歷史程式命名為 manager）、idempotency 與原子 audit |
| 多專案 Worker Task 6 | 已完成並推送 | multi-board metadata/content、per-board revision、archive/restore 與 migration-aware `/board` alias；未套用遠端 |
| 多專案 Worker Task 7 | 已完成並推送 | Project summary、六個月月報、server-side Board diff 與 Project/Board Activity Log cursor API；未套用遠端 |
| 多專案 Worker Task 8 | 已完成並推送 | Attachment API 與 R2 key 已限定到 Workspace/Project/Board；三角色與 archived read-only 已驗證，未套用遠端 |
| 多專案 Client Task 9 | 已完成並推送 | runtime `/me` session、Project/Board v2 client、scoped Attachment API、嚴格 parser 與統一錯誤 mapping |
| 多專案 Client Task 10 | 已完成並推送 | per-board store/revision/sync、queue v2、stale response suppression 與 legacy queue blocker |
| 多專案 Client Task 11 | 已完成並推送 | Web／Capacitor 共用 ProjectApp、我的專案、專案摘要、Board switcher、嚴格 hash route 與 viewer/archive 唯讀 UI |
| 多專案 Client Task 12 | 已完成並推送 | owner Project／Board lifecycle（歷史程式命名為 manager）、成員角色、archived views、summary filter、Activity Log cursor 與離線管理 guard |
| 多專案 Task 13 | 已完成並推送 | legacy lock/copy/rollback、client merge/remote、一次性 backup、personal token 換發、verification script 與 E2E |
| 多專案 Task 14 | 已完成並推送 | staging-ready CI、fresh clone／原生完整關卡、受限 token CLI 與 staging/token/reset runbooks |
| 任務多人指派 v1.1 | 已完成並發布 Beta | Card schema v5、Project member 多選、Worker membership validation、離開成員保留與 assignment audit 均已進 staging／Beta |
| 任務流動與阻塞狀態 | 已完成並發布 Beta | 任務可標示 blocked、原因與起始時間，並可依阻塞狀態篩選；Activity Log 只記欄位變更，不洩漏原因內容 |
| 動態工作流欄位 | 已完成並發布 Beta v15 | owner 可新增／改名／排序／設定 WIP／刪除空欄；member 可編輯與移動任務但不能管理工作流；完成欄 identity 受保護 |
| 輸入與響應式看板 | 已完成並發布 Beta v15 | 修正繁中注音 IME 組字；桌面與 Mobile 欄位固定同一水平列，溢出時水平捲動，Mobile 滿版吸附 |
| staging 設定 | 已建立並部署 | staging Worker、D1、private R2、migration、owner 與 personal token 已完成；待 RC 多角色／多裝置驗收 |
| CI | 已完成 | PR/main 會驗證 Web、Worker、Android debug 與 iOS simulator |
| Web/PWA | 已搬遷 Cloudflare Workers | [Kanban Beta](https://kanban-beta.wongchamber.com) 由 `kanban-beta` Worker 託管（custom domain＋Cloudflare Access email OTP 白名單），以 `pnpm web:deploy:beta` 發布；含流動度量與服務類別 v1（schema v7），已通過瀏覽器驗收 |
| Sites 關聯 | 已退場 | 舊 chatgpt.site Beta（v15）已停用；`.openai/hosting.json` 與 sites build plugin 已自 repo 移除 |
| 客製 title | 已完成並發布 Beta | `public/app-config.json` 控制畫面與 WebView title；Beta v15 與 Mobile build 5 使用 `定恆人工智能` |
| staging Worker/D1/R2/token | 已建立 | 和 production 完全隔離；URL 與非敏感 inventory 見 staging runbook |
| production Worker/D1 | 既有 3a 上線 | 尚未部署本次 3b Worker |
| production R2 | **尚未建立** | 必須等 staging 驗收全數通過 |
| iOS/Android | `1.1.0 (8)` 發布候選已建置，待上傳分發 | 在 `6aa4eed` 上執行完整 `pnpm mobile:sync`，兩平台四個 Capacitor plugins 均同步（bundle `index-_Gh2PLee.js`，含日曆、人力甘特圖與 schema v8）。iOS archive 已產出並驗證：`com.wong-chambers.WongKanban`、1.1.0 (8)、`ARCHIVE SUCCEEDED`，待由 Xcode Organizer 上傳 TestFlight。Android AAB 已簽章產出並驗證：`com.wongchamber.WongKanban`、versionName 1.1.0、versionCode 8、簽章者 `CN=Wong Chambers`（SHA384withRSA，效期至 2053），待上傳 Play Console 內部測試軌道。**build 7 及更早是 v7 客戶端**，以 owner 身分編輯已排期看板會靜默抹除該看板全部 `assignmentWindows`；本版修正此風險，裝上新版前手機端不應以 owner 編輯卡片。日曆與人力甘特圖為桌面專用（< 900px 顯示引導訊息），手機端不會出現這兩個檢視。尚缺實機安裝 smoke 與正式分發 |
| 流動度量與服務類別 v1 | Worker 已部署 staging，待 Web Beta 發布與驗收 | Card schema v7：欄位進入／開工時間、累計阻塞、服務類別與加急 WIP；卡面老化與流動報表；Worker 驗證與 summary 流動度量。已推送 `3329721`；staging Worker version `8070b48c-4ee6-4544-a069-b7a1f23f54be`，無 token／錯 token 均回 401；Web Beta v16 待從 Sites 發布 |
| 多看板與看板指派 v1 | 已部署 staging，待人工驗收 | migration `0005` 已套用 staging D1（5 commands）；staging Worker version `f132bf43-4d3f-4b62-94d7-af612fb47cf5`，無 token／錯 token 對 `/me`、`/projects` 均回 401；Web Beta version `c9646e12-249d-40ae-a523-17fb70c7dedd`，Access 仍正常擋下未授權請求（302）。migration `0005_multi_board_assignments.sql`：移除 `0003` 單看板唯一索引，新增 `project_member_boards`；owner-only 指派 API（`GET`／`PUT /projects/:projectId/members/:userId/boards`，每位 member 上限 50 個看板，空陣列＝回到 fallback，寫入 `member.boards_assigned` audit）；member 依指派列決定可見 Board，完全沒有指派列時 fallback 到主要看板（active 看板中 `updated_at DESC, id DESC` 第一個），owner／legacy viewer 恆全可見；member 對未可見 Board 的內容、附件與 Log 一律 404，`listBoards`、summary 與 `listProjects` 代表看板均已收斂到可見集合；owner 可在專案總覽新增看板，member 面板以 checkbox 群指派（樂觀更新），單一可見看板時自動落板且不顯示切換器，被移除指派時顯示可關閉 banner |
| 平台管理指派專案成員 v1 | 已部署 staging，待人工驗收 | 已合入 main（`cb44d55`）；staging Worker version `40e86dc5-6393-479a-a32b-f6675f86d5a5`，無 token 對 `/me` 與 `/admin/users` 均回 401；Web Beta version `c1a2d9dd-8169-4241-be99-28d1ac8e9f24`，Access 仍正常擋下未授權請求（302）。無 D1 migration。workspace owner／admin 可從使用者管理指派任何專案的成員與角色；放寬只作用於 `PUT`／`DELETE /projects/:projectId/members/:userId`，其餘 manage 操作不變；新增 admin-only `GET /admin/users/:userId/projects`；專案外 admin 的變更在 Activity Log 標 `via: "platform_admin"`。指派 UI 已改為 checkbox 決定是否參與、同列 select 決定角色，未勾選時 select 停用；select 不再提供「未參與」選項，避免同一件事有兩個入口 |
| 跨專案日曆檢視 v1 | 已部署 staging 與 Web Beta，待人工驗收 | 管理者專屬 `GET /calendar?workspaceId=&month=`；workspace owner／admin 得到全 workspace active 專案、Project owner 得到他 own 的、其餘 403；只回未完成卡與 active 看板，不含描述／checklist／附件／阻塞原因；卡片以 SQLite `json_each` 在 SQL 層過濾（D1 已實測支援）；未排程池上限 200、看板上限 50，超出以旗標明示；v1 純檢視、桌面專用（< 900 px 顯示引導訊息）。已合入 main（`df85fe8`）；無 D1 migration；staging Worker version `77070cdd-60f8-4cdc-b104-1451d7202487`，無 token／錯 token 對 `/calendar` 與 `/me` 均回 401；Web Beta version `b6033548-7155-40b8-99e5-0782cf7f0243`，Access 仍正常擋下未授權請求（302）。導覽日曆入口對 workspace admin 與非 admin 的 Project owner 皆可見，且 SQL 對非物件卡片有型別守門 |
| 人力甘特圖 v1 | 已部署 staging 與 Web Beta，待人工驗收 | Card schema v8 新增 `assignmentWindows`（每位指派人各自的計畫投入期間，date-only 含頭尾；`userId` 須為 `assigneeUserIds` 子集、每人至多一筆、每卡上限 20；缺 window＝未排期，非錯誤）；migration 一律補空陣列，不替舊卡推導日期。指派名單與投入期間收斂為只有 Project owner 可變更，以逐卡 `assignmentSignature` 比對實作——只比對兩版都存在的卡片，缺席鍵與空陣列視為同一簽章（避免舊看板 member 編輯被誤 403 鎖死，即流動度量 v7 上線前抓到的同一坑）。新增 `GET /assignments?workspaceId=&from=&to=`，範圍複用 `resolveCalendarScope`，窗長上限含頭尾 31 天；看板選取為全域 Top-50（`updated_at DESC, id DESC`），bars 上限 2000、未排期上限 200，三者皆有對應截斷旗標；卡片與 window 以雙層 `json_each` 展開，內層以 `CASE` 守門，外層另加 `json_valid`／`json_type` 守門避免畸形資料致 500。新路由 `#/resources?from=YYYY-MM-DD`：每人一列、lane packing 分層、同日並行以文字＋樣式雙區隔標示過載、未排期側欄、預設 14 天可前後移動；v1 純檢視（不可在甘特圖上拖拉調整期間）、桌面專用（< 900px 顯示引導訊息）。無 D1 migration（`assignmentWindows` 住在 `boards.data` 的 JSON blob 內），但因權限收緊，部署順序不可顛倒，見下方 P1 部署備註。已合入 main（`ea6d46a`）；staging Worker version `6e36a147-aeb3-4b4a-9345-483c69f718e0`，無 token／錯 token 對 `/assignments`、`/calendar`、`/me` 均回 401；Web Beta version `f47eec1d-9676-4545-9d0f-41dd33424342`，Access 仍正常擋下未授權請求（302） |
| 看板時間軸魚骨圖 v1 | 已實作並通過九項品質關卡，待合併 main 與 staging 部署 | Card schema v9 新增 `parentCardId: string \| null` 與 `MAX_CARD_DEPTH = 3`（頂層為第 1 層）；純結構分解，**不做狀態上捲**——完成、WIP、老化、Cycle Time、阻塞、加急排序全部各卡各算，不提供子樹聚合計數。`normalizeCardHierarchy` 幂等修正四種壞連結（指向不存在卡片、指向自己、成環、超深度）；刪除父卡時子卡升為頂層（由 normalize 第一步自然達成，`deleteCard` 未改）。migration 一律補 `null`。順帶修掉既有原型鏈缺陷：`parentCardId`／`column.cardIds`／`deletedCards` 等以外部可控字串查表的存在性判斷，`merge.ts` 的 placement 迴圈與 `normalizeCardHierarchy`／`cardDepth` 皆已改用 `Object.hasOwn`（修正前 Worker 會放行 `parentCardId: "constructor"` 寫入 D1，導致 client 端 TypeError 或該裝置同步永久癱瘓）。Worker `requireValidCardHierarchy` 在 `createBoard`／`putBoardContent`／`putLegacyRow` 三處接上，**缺席即通過**，五種違規各回 400 `invalid_card_hierarchy`；`parentCardId` 不在 `assignmentSignature` 內，member 可改（有測試釘住舊看板 lockout 回歸與權限界線）。Activity Log 新增 `parentCardId` 欄位（只記欄位名）。新路由 `#/projects/:projectId/boards/:boardId/timeline`：主骨為時間軸，已開工卡片依 `startedAt`（以檢視者本地時區取日）定位、上下交錯；子卡與父卡同側，以虛線連父卡，父卡未開工時子卡直接接主骨；同日向外堆疊；未啟動池在左端；縮放五級距 `8/12/16/24/32` px/日（預設 16）＋CSS 全螢幕（Esc 退出，overlay 疊層時只關最上層）；桌面專用（< 900px 顯示引導訊息並隱藏工具列）。卡片面板新增「上層任務」選單，候選來自 `eligibleParentCards`（編輯模式）或深度過濾（新增模式），排除自己、子孫與會超深度的目標；member 可改，只有整卡唯讀才 disabled。**無 D1 migration、無新 Worker 端點、無權限放寬**，但部署順序不可顛倒，見下方 P1 部署備註。尚未合入 main，仍在 `feature/board-timeline-fishbone-v1` 分支（實作完成點 `80b4487`）；九項品質關卡已於本次文件更新一併重跑並全綠（單元測試 336、Worker runtime tests 208，其餘七項為 lint／typecheck／build／mobile:build／worker:types:check／staging dry-run／`git diff --check`）。 |

### 已完成的驗證

- 已推送候選版曾通過 52 個單元測試、8 個 Worker runtime tests、lint、typecheck、
  Web/mobile build、production/staging Worker dry-run、Android debug build、未簽章
  iOS simulator build 與 final mobile sync。
- 客製 title 變更已通過 56 個單元測試、lint、typecheck、Web build、
  mobile build 與完整 `pnpm mobile:sync`。
- 多專案 Milestone A 已通過 104 個單元測試、lint、typecheck、Web build 與
  mobile build；localStorage 中斷後可重跑修復，原 legacy key 不刪除。
- 多專案 Task 3 已通過 112 個單元測試、8 個 Worker runtime tests、lint、typecheck，
  並以隔離本機 D1 驗證 fresh 與含 legacy board 的 0001→0002 路徑。
- 多專案 Task 4 已通過 112 個單元測試、12 個 Worker runtime tests、lint、typecheck，
  以及 production/staging Worker dry-run；未部署。
- 多專案 Task 5 已通過 112 個單元測試、21 個 Worker runtime tests、lint、typecheck、
  typed `no-floating-promises` 檢查，以及 production/staging Worker dry-run；另驗證 audit
  寫入失敗時 Project mutation 會完整回滾，未部署。
- 多專案 Task 6 已通過 113 個單元測試、33 個 Worker runtime tests、lint、typecheck、
  typed `no-floating-promises` 檢查，以及 production/staging Worker dry-run；已驗證
  Board A/B revision 隔離、concurrent write、archive/restore、audit rollback，與 `/board`
  在 migration pending／locked／complete 的單一權威資料切換，未部署。
- 多專案 Task 7 已通過 115 個單元測試、40 個 Worker runtime tests、lint、typecheck；
  已驗證 Project/Board Log 隔離、同 timestamp cursor、archived history、summary archived
  filter、六個月零值與 audit 隱私，且 Task 6 audit rollback 測試持續通過，未部署。
- 多專案 Task 8 已通過 115 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  generated Worker types check 與 production/staging Worker dry-run；已驗證三角色權限、
  Project/Board R2 key 隔離、archived read-only、10 MiB 邊界，及 authz failure 不碰 R2，
  未部署。
- 多專案 Task 9 已通過 124 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build 與 mobile build；已驗證 nested resource path、嚴格 response parser、
  401/403/404/409/archived mapping，以及 token/user 切換不會沿用舊 session 或刪除本機
  Board data。
- 多專案 Task 10 已通過 133 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build 與 mobile build；已驗證 Board A/B queue 並行安全、完整 scope 隔離、
  stale response suppression、pending upload gate、archived/403/404 停止自動重試，
  以及舊 queue/revision 的安全 migration blocker。
- 多專案 Task 11 已通過 137 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build 與 mobile build；已驗證嚴格 hash routing、無權 context fallback、
  Project role／archive 唯讀 actions，以及 scoped 附件重試下載。
- 多專案 Task 12 已通過 140 個單元測試、46 個 Worker runtime tests、lint、typecheck、
  Web build、mobile build 與完整 mobile sync；已驗證 owner-only actions（當時命名為
  manager）、last-owner guard、archived read-only、Log filter/cursor、summary archived filter
  與離線管理操作不進 queue。
- 多專案 Task 13 已通過 144 個單元測試、48 個 Worker runtime tests、lint、typecheck、
  Web/mobile build、Worker types check 與 production/staging dry-run；已驗證 legacy
  lock/copy/rollback、merge/remote、一次性 backup、personal token 驗證後撤銷 shared
  token，以及角色、Board 隔離、archive 與 alias authority E2E。
- 多專案 Task 14 已在 `fb7c609` 的 fresh clone 通過 frozen install、150 個單元測試、
  48 個 Worker runtime tests、12 個 client migration 與 8 個 role/legacy alias
  release tests、lint、typecheck、Web/mobile build、Worker types、production/staging
  dry-run、final mobile sync、Android debug 與未簽章 iOS simulator build。Artifact
  fixture-token 與 tracked secret-file scan 無命中。
- staging 候選 `de24a29` 已在 fresh clone 通過 frozen install、153 個單元測試、
  48 個 Worker runtime tests、12 個 client migration 與 8 個 role/legacy alias
  release tests、lint、typecheck、Web/mobile build、generated Worker types、
  production/staging dry-run、final mobile sync、Android debug 與未簽章 iOS simulator
  build。另掃描 362 個 tracked/log/build artifact files，staging token 與 token hash
  均為 0 命中。
- personal token 首次連線修正 `d43eb3f` 已通過 156 個單元測試、lint、typecheck、
  Web build 與 mobile build；personal token 驗證 `/me` 後會直接重新載入
  ProjectApp，不再要求 fresh multi-project staging 提供 legacy `/board`。
- 任務多人指派 v1.1 已通過 159 個 client tests、49 個 Worker tests、8 個 release
  tests、lint、typecheck、Web/mobile build 與 staging Worker dry-run。Board schema
  v5 migration 保留 v4 `completedAt`，Worker 只允許新指派目前的 Project members。
- 工作流欄位管理 `8a44490` 已通過 183 個 client tests、56 個 Worker tests、lint、
  typecheck、Worker types、Web/mobile build、staging dry-run、Android debug、iOS
  simulator 與 Apple Development device build。Owner 可新增／改名／排序／設定 WIP／
  刪除空欄；完成欄 identity、非空欄與最少工作欄受 client/Worker 雙重保護。
- 水平單列修正 `f007174` 已通過 183 個 client tests、lint、typecheck 與 Web build；
  1590 px 桌面五欄頂端座標一致，390 px Mobile 每欄 370 px、同列且使用 mandatory
  scroll snap。Private Sites Beta v15 已發布。
- Mobile `2bd8506` 已完成 iOS／Android final sync 與 build 5 實機部署。iPhone 12 Pro
  Max 回報 `1.1.0 (5)` 且 App 程序成功啟動；Pixel 9a 回報 `versionName 1.1.0`、
  `versionCode 5` 且程序成功啟動。兩份 bundle 均包含水平單列 CSS 與 staging URL。
- `47f604f` 已執行完整 `pnpm mobile:sync`；iOS/Android bundle 均包含多人指派 UI，
  Android debug APK 與未簽章 iOS simulator build 成功。詳細差距與下一批工作見
  [Mobile 進度報告](./docs/reports/mobile-progress-2026-07-30.md)。
- 隔離的 staging Worker、D1、private R2、migration、owner、personal token 與驗證
  Project/Board 已建立，authenticated smoke 與 R2 scope round-trip 已通過。目前
  staging Worker 版本為 `a78e0c42-7557-49b3-9f09-5e27af9ee3de`，private Beta v15
  已從 `f007174` 發布；下一步是 P0-4 多角色、雙裝置、附件與完整實機驗收。

## P0-1：發布 Web private Beta（已完成）

Sites Beta v15 已從 `f007174` 發布，保留 owner-only custom access。驗證結果：

- [x] 通過 owner-only 存取後，`/`、`/privacy`、`/support` 都回 200；未授權訪客會被拒絕。
- [x] 通過 owner-only 存取後，`/app-config.json` 回 200，提供客製 title `定恆人工智能`。
- [x] 發布後 10 分鐘內 Sites Worker error log 無事件。
- [x] personal token 首次連線不再依賴 legacy `/board`。
- [x] Safari 已進入「我的專案」與 Project Board；Project Board 主標題使用專案名稱。
- [x] Web 與原生 App 使用 JSON title `定恆人工智能`。
- [x] 繁中注音 IME 可完成組字，不會因輸入事件重建欄位而中斷。
- [x] 動態工作流欄位在桌面與 Mobile 都維持單一水平列，不建立上下層級錯覺。
- [ ] 人工確認線上重新整理、離線 fallback 與 PWA service worker 升級。

限制：iOS/Android 會把 JSON 包入 App，修改後仍需 `pnpm mobile:sync` 與新 build。
手機桌面圖示下方的 App 名稱是原生 metadata，不能只靠 App 重啟變更。若未來要求已安裝
App 在不更新版本的情況下取得新 title，需要另外設計公開且可驗證的遠端設定端點。

## P0-2：多專案／單看板 v1（已完成實作）

歷史規格、現行角色規格與實作計畫：

- [多專案／多看板管理 v1 歷史規格](./docs/superpowers/specs/2026-07-24-multi-project-multi-board-design.md)
- [多專案／多看板 v1 實作計畫](./docs/superpowers/plans/2026-07-24-multi-project-multi-board-v1.md)
- [admin／owner／member 與單 Project 單 Board 規格](./docs/superpowers/specs/2026-08-03-project-admin-owner-member-design.md)
- [admin／owner／member 實作計畫](./docs/superpowers/plans/2026-08-03-project-admin-owner-member-plan.md)

2026-08-03 起，現行產品規則收斂為「一個 Project 對應一個主要 Board」。舊多看板
domain、migration 與 archive 能力保留作相容與歷史資料用途，不再作為一般 UI 的建立
模型。

依計畫的 14 個 Task 實作：

1. Workspace → Project → Board domain types、local index、active context 與舊資料 migration。
2. D1 workspace、user accounts、access tokens、projects、memberships、boards、activity logs。
3. 個人 Bearer token、Project roles 與 Worker server-side authorization。
4. `/me`、Project、members、Board content、archive/restore API v2。
5. 「我的專案」、Project overview、Board switcher 與 role-aware UI。
6. per-board revision、sync debounce、queue v2 與 board-scoped R2 attachment key。
7. Project summary、server-side diff ActivityLog 與 archived read-only UI。
8. legacy `/board` alias、single-board D1/local migration 與 shared token 換發。

完成條件：

- 一位 user 可加入多個 Project，並在各 Project 擁有獨立角色。
- 未參與 Project 無法列出、讀取或猜測內容。
- Project/Board 名稱彼此獨立；每個 Project 只有一個主要 Board。
- summary 只聚合目前 Project，沒有跨 Project dashboard。
- 封存後內容、附件與 Log 可讀但不可修改。
- 舊單一 Board、月報、附件 refs、墓碑與 revision 無資料遺失。
- 單元、Worker runtime、Web/mobile build 與 local migration tests 全綠。

在本節完成前，**不要建立 staging 遠端資源**。

### v1.1：任務多人指派

- [規格](./docs/superpowers/specs/2026-07-30-multi-assignee-tasks-design.md)
- [實作計畫](./docs/superpowers/plans/2026-07-30-multi-assignee-tasks-v1.md)

已完成 Card schema v5、Project member 多選、多人名稱顯示、離開成員保留、
Worker membership validation 與 Activity Log changed fields，並已部署 staging Worker
與 private Beta。剩餘工作是三角色、雙裝置與附件交互的人工驗收。

## P0-3：建立完全隔離的 staging（已完成）

正式資源不得拿來測試 3b。建立以下獨立資源：

| 類型 | staging 名稱 | production 名稱 |
| --- | --- | --- |
| Worker | `kanban-sync-staging` | `kanban-sync` |
| D1 | `kanban-sync-staging` | `kanban-sync` |
| R2 | `kanban-attachments-staging` | `kanban-attachments` |
| Token | staging 專用 | production 專用 |

已完成：

1. [x] 建立 `kanban-sync-staging` D1。
2. [x] 將實際 `database_id` 固定寫回 `worker-sync/wrangler.jsonc` 的 staging binding。
3. [x] 建立 private `kanban-attachments-staging` R2，未設定公開網域。
4. [x] 執行 `pnpm sync:migrate:staging`，`0001`～`0004` 均已套用。
5. [x] 產生只供 staging 使用的高熵 personal token：
   - D1 只儲存 SHA-256 hash。
   - 明文不得進 repo、shell history、CI log、測試快照或前端 bundle。
6. [x] 執行 `pnpm sync:deploy:staging`。
7. [x] 以安全注入的環境變數執行只讀 authenticated smoke test：

   ```bash
   KANBAN_SYNC_URL="https://<staging-worker>" \
   KANBAN_SYNC_TOKEN="<staging-token>" \
   pnpm sync:smoke
   ```

8. [x] 記錄 staging URL、資源 ID、token 建立日期與撤銷方式，但不記錄 token 明文。

非敏感 inventory：

| 類型 | 值 |
| --- | --- |
| Worker URL | `https://kanban-sync-staging.clerk-wong.workers.dev` |
| Worker deployment | `a78e0c42-7557-49b3-9f09-5e27af9ee3de` |
| D1 | `kanban-sync-staging` / `bcae6724-352b-453d-92e4-28bcf229f76f` |
| R2 | private `kanban-attachments-staging` |
| Owner | `a14c7f5d-4c2e-8896-07652625d722` / `Staging Owner`（現行 Project role：owner） |
| Token | personal `owner-web`，建立日期 2026-07-27；明文只存本機 Keychain |

驗收證據：

- 無 token 與錯 token 都回 401；owner personal token 對 `/me` 回 200。
- `/me` 回傳一個 owner Workspace；fresh staging 起初可合法回傳空 Project list，P0-4
  隨後建立一個驗證 Project 與兩個 Board。
- smoke script 已改以 multi-project `/me`、`/projects` 與可選的第一個 Board 做只讀
  驗證，不再把 fresh cutover 後不存在的 legacy `/board` 當成錯誤。
- migration state 為 `complete`；D1 token inventory 只查非敏感 metadata。
- production Worker、D1 與 R2 均未變更。

完成條件：

- [x] staging Worker、token、D1 與 R2 和 production 完全隔離。
- [x] staging 失敗或清除資料不影響既有 production 3a。
- [x] 未帶 token、錯 token 與有效 token 分別得到預期結果。
- [x] 維運命令與 Worker response 未輸出 Bearer token、token hash 或附件內容。

## P0-4：staging Release Candidate 驗收

至少使用兩個獨立瀏覽器 profile，並加入一台 iOS 或 Android 實機。所有項目通過前，
不得建立 production R2 或部署 production 3b。

### 自動化

- [x] `8a44490`／`f007174` 通過 183 個 client tests、56 個 Worker tests、lint、
  typecheck、Worker types、Web/mobile build、staging dry-run 與雙平台 native build。
- [x] iOS／Android `1.1.0 (5)` 已完成 final sync、實機覆蓋安裝、啟動與版本核對。
- [x] `de24a29` fresh clone 在 final mobile sync 後工作樹乾淨，`git diff --check` 通過。
- [x] `pnpm install --frozen-lockfile` 可從 fresh clone 完成。
- [x] `pnpm test`（153）、`pnpm worker:test`（48）、lint、typecheck 全綠。
- [x] Web build、mobile build、generated Worker types check 全綠。
- [x] production/staging Worker dry-run 全綠，bindings 分別指向各自 D1/R2。
- [x] Android debug 與未簽章 iOS simulator build 全綠。
- [x] 362 個 tracked、Wrangler log 與 Web/mobile/native build artifact files 中，實際
  staging token 與 SHA-256 hash 都是 0 命中。

### Staging API 基線

以下 A/B Board 是多看板階段留下的隔離驗證 fixture；現行一般 UI 只允許每個 Project
一個主要 Board。fixture 僅保留作 migration、archive 與 scope 回歸測試，不代表目前的
產品建立流程。

- Project：`449390b4-b03a-4e60-8873-991eece77f37` / `Staging 驗證專案`；歷史資料角色
  `manager` 對應現行 `owner`。
- Board A：`655c1c1c-e54d-4006-9670-84959b26b58d` / `Web 驗證看板`，revision 1。
- Board B：`20a59286-a61f-4cbf-a6dc-d14a0d4a0222` / `App 驗證看板`，revision 0。
- 相同 attachment ID 在 A/B 寫入不同 bytes 後可各自讀回，證明 Board-scoped R2
  隔離；測試物件已刪除，bucket 回到 0 objects / 0 B。
- 建立資料後 authenticated smoke 通過：1 Workspace、1 Project、抽驗 1 Board。

完整命令：

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

### 多專案與權限

- [ ] 「我的專案」只顯示呼叫者參與的 Project。
- [ ] 同一 user 可在 Project A 為 owner、Project B 為 member。
- [ ] workspace admin 未加入 Project 時只能看管理 metadata，不能讀工作內容。
- [ ] member 可改 Card、多人指派與任務狀態，但不能管理成員或封存 Project/Board。
- [ ] owner 可管理 Project 成員與工作流；admin 可建立／封存 Project，但未加入時不能讀工作內容。
- [ ] legacy viewer 可讀 Board、Attachment、summary 與 Log，但不能 mutation。
- [ ] owner/member 可指派多位 Project members；legacy viewer 只能查看負責人。
- [ ] 非 Project member 不能被新指派；成員離開後既有指派保留且可移除。
- [ ] 多人任務移到完成欄時仍只有一個 Card-level `completedAt`。
- [ ] Project 與 Board 名稱可不同，改名互不影響。
- [ ] 不同 Project 的 Board revision、離線 cache 與 queue 彼此隔離。
- [ ] Project summary 不混入其他 Project，預設排除 archived Board。
- [ ] 封存後唯讀、可看 Log，還原後 revision 與資料不重置。
- [ ] 卡片跨欄移動後老化天數歸零；同欄重排不歸零。
- [ ] v6 舊資料升級後報表顯示「無度量資料」，`completedAt` 未變。
- [ ] member 可改服務類別；member 不能改老化門檻與加急上限（Worker 403）。
- [ ] 舊版 client（無 settings payload）儲存看板不會清掉 owner 設定。
- [ ] 加急卡在桌面與 Mobile 都固定排在欄位前段；超過上限時警告不阻擋。
- [ ] 雙裝置的 Cycle Time／阻塞時長在同步收斂後一致。
- [ ] owner 可在同一專案建立第二個看板並正常切換、封存。
- [ ] 單一指派的 member 進專案直接看到任務，畫面沒有看板切換器。
- [ ] 多指派的 member 只看到被指派的看板。
- [ ] member 直接輸入非指派看板的 hash route 會被導回，API 回 404。
- [ ] 未設定指派的既有 member 升級後仍能正常使用主要看板。
- [ ] member 的報表只聚合可見看板；owner 聚合全部。
- [ ] 移除指派後該 member 的 client 停止重試並顯示可理解訊息。
- [ ] workspace admin 可從使用者管理把使用者加入專案、改角色、移除。
- [ ] admin 自我指派成功，且 Activity Log 可辨識（actor 與 target 相同）。
- [ ] 專案外 admin 的 membership 變更在 Activity Log 標 `via: "platform_admin"`；本身是專案 owner 時不標。
- [ ] 移除最後一位 owner 顯示「此專案至少需要一位 owner，請先指派其他 owner。」而非泛用訊息。
- [ ] archived 專案的既有 membership 唯讀顯示；active 專案可指派。
- [ ] 變更後使用者列的「參與專案」件數更新。
- [ ] 放寬未外溢：未加入專案的 admin 對該專案的看板內容、附件與 Log 存取行為不變。

### 3a 看板同步

- [ ] 首台裝置可選擇合併或採用遠端 legacy Board。
- [ ] 第二台裝置最終收斂到同一看板。
- [ ] 新增、編輯、移動、完成、重開與刪除均可收斂。
- [ ] 離線修改後重啟，恢復連線或回前景會自動同步。
- [ ] 409 合併與 adopt-remote 分支不遺失較新的卡片。
- [ ] 錯 token 顯示可理解訊息，本機資料不受影響。

### 3b 附件同步

- [ ] A 裝置新增照片或錄音，B 裝置可下載、顯示與播放。
- [x] Attachment endpoint 與 R2 key 都包含正確 Project/Board scope；同 attachment ID
  的 A/B round-trip 不互相覆寫。
- [ ] 無 membership 的 user 即使知道 attachment ID 仍無法下載。
- [ ] 遠端 board 不會先發布尚未成功上傳的附件參照。
- [ ] B 裝置先看到參照時，下載失敗可重試，不會永久卡住。
- [ ] 離線新增後重啟 App，恢復連線或回前景會補傳。
- [ ] 單附件移除、刪卡與重設看板最終清除 R2。
- [ ] 取消草稿不留下本機或 R2 orphan。
- [ ] 10 MiB 邊界、空 body、異常 key 與 404/413 行為符合預期。
- [ ] 切換同步 URL/token 不會把舊 queue 送到新環境。
- [ ] upload/download/delete 重試冪等，不重複也不漏失。

### 月報

- [ ] 完成月份以 `completedAt` 計算。
- [ ] 完成後修改標題、附件或 checklist 不會改變原完成月份。
- [ ] 移出再移回完成欄符合目前定義。
- [ ] 最近六個日曆月包含零資料月份。
- [ ] UTC 月界線在 Asia/Taipei 顯示正確。
- [ ] v1/v2/v3 舊資料 migration 結果可接受。

### 跨專案日曆檢視

- [ ] workspace admin 的日曆含全 workspace 所有 active 專案的本月卡片。
- [ ] Project owner 只看到他 own 的專案；member 與 viewer 開 `#/calendar` 被導回「我的專案」。
- [ ] 以非 admin 的 Project owner 帳號登入，導覽列出現日曆入口（但沒有「平台管理」入口），
      且日曆只含他 own 的 active 專案。
- [ ] member 直接呼叫 `/calendar` 端點得到 403，無法藉此讀取未指派看板的卡片。
- [ ] 逾期、阻塞、加急三種卡片同時有文字與樣式區隔。
- [ ] 未排程池顯示無截止日的卡片；超過 200 筆時明示已截斷。
- [ ] 側欄的每人件數與未指派卡數正確。
- [ ] 月份切換更新 URL，且以 `#/calendar?month=YYYY-MM` 直接開啟可重載該月。
- [ ] 已完成卡、archived 專案與 archived 看板的卡片不出現。
- [ ] 視窗縮到 900 px 以下顯示引導訊息而非破版月曆。

### 人力甘特圖

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

### 看板時間軸魚骨圖

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

### Web/PWA 與客製設定

- [x] private Beta v15 仍是 owner-only custom access。
- [x] JSON title、metadata 與登入頁主標題一致；進入 Project 後 H1 改用專案名稱。
- [ ] 人工確認 Slack／訊息等分享預覽使用最新品牌圖與文字。
- [x] 動態欄位在桌面與 Mobile 維持同一水平列；溢出時水平捲動。
- [ ] HTTPS 安裝、離線冷啟動及 service worker 升級正常。
- [ ] 新版設定線上立即取得，離線仍有可用 fallback。
- [ ] 瀏覽器附件與麥克風權限拒絕／恢復流程正常。
- [x] 線上 `/privacy` 與 `/support` 回 200。

### iOS / Android 實機

- [x] `47f604f` 執行過完整 `pnpm mobile:sync`，四個 Capacitor plugins 均同步。
- [x] Android `:app:assembleDebug` 成功並產出 debug APK。
- [x] iOS `.xcworkspace` generic simulator 未簽章 build 成功。
- [x] `1.1.0` 安裝並啟動於 iPhone 17 Pro / iOS 26.5 Simulator；確認原生 launch、
  本機 Board 首畫面與 Mobile「說明」入口呈現，並補上 React 載入前靜態畫面。
- [x] iOS/Android native bundle 都包含多人指派介面。
- [x] 以 `assets/` Kanban 品牌來源取代 Capacitor 預設 icon/splash，並加入
  `pnpm mobile:assets` 可重現產生流程。
- [x] 內測更新設為 iOS `1.1.0 (3)`、Android `1.1.0 (versionCode 3)`；包含可客製化工作流欄位名稱的最新 Mobile bundle。
- [x] build 3 已通過 Android debug APK、iOS simulator 與 Apple Development 簽署的 iOS device build。
- [x] build 3 已覆蓋安裝並啟動於 iPhone 12 Pro Max；裝置回報版本 `1.1.0 (3)`。
- [x] build 3 已覆蓋安裝並啟動於 Pixel 9a；裝置回報 Android `versionName 1.1.0`、`versionCode 3`。
- [ ] 在 iPhone 與 Pixel 9a 驗證登入憑證保留、欄位改名與任務移動。
- [x] Project Owner 工作流管理已支援新增欄位、設定 WIP、左右排序與刪除空欄；完成欄與非空欄位不可刪除，member 仍只能編輯／移動任務。
- [x] 欄位管理已加入 Worker 權限與安全轉換驗證，以及 created／renamed／WIP／moved／deleted audit diff；183 個 Web 測試與 56 個 Worker 測試通過。
- [x] build 4 已通過 Mobile sync、Android debug、iOS simulator 與 Apple Development 簽署的 iOS device build；產物位於 `outputs/mobile/`。
- [x] build 5 已覆蓋安裝並啟動於 iPhone 12 Pro Max；裝置回報 `1.1.0 (5)`。
- [x] build 6（含流動度量與服務類別 v1、schema v7）已以 Release＋Apple Development
  簽章覆蓋安裝並啟動於 iPhone 12 Pro Max；bundle 版本 `1.1.0 (6)`。iOS 已人工驗證
  加急卡正常同步到 Web。
- [x] Android build 6 debug APK 已覆蓋安裝並啟動於 Pixel 9a；裝置回報
  `versionName 1.1.0`、`versionCode 6`。注意：本機 gradle 需 `JAVA_HOME`
  指向 JDK 21（Homebrew `openjdk@21`）；CocoaPods 需 `LANG=en_US.UTF-8`。
- [x] build 5 已覆蓋安裝並啟動於 Pixel 9a；裝置回報 `versionName 1.1.0`、`versionCode 5`。
- [x] build 5 的 iOS／Android bundle 均包含水平單列 CSS 與 staging URL；Android APK
  由 debug keystore 簽署，iOS App 由 Apple Development identity 簽署。
- [x] Mobile 每欄維持滿版、同一水平列與 mandatory scroll snap；新增第五欄不再換到下方。
- [x] 補 Mobile bundle 內可離線讀取的支援／隱私面板，內容與 Web 共用。
- [x] Android debug APK 已由 debug keystore 簽署，可供受控內部測試。
- [x] 本機已有有效 Apple Development／Distribution identity；iOS Release device
  build 與本機 `.xcarchive` 成功，archive 目前以 Apple Development + team
  provisioning profile 簽署，尚未做 distribution export／上傳。
- [ ] 提供 Android release keystore 與 CI secret，再產生 release-signed AAB／APK。
- [x] Android release signing 已改由四個 `KANBAN_ANDROID_*` 環境變數注入；缺少任一
  secret 時 release task 會立即停止，keystore 類型亦加入 `.gitignore`。
- [ ] 產生 TestFlight 或 internal track build。
- [x] personal token 改用 iOS Keychain 與 Android Keystore-backed AES-GCM storage；
  原生 App 啟動時會一次性遷移 WebView localStorage，只有安全寫入成功才刪除舊 token。
- [x] 安全儲存改為非同步平台能力；首次登入、legacy token 換發、停用同步、附件下載
  重試與 Project/Board bootstrap 均使用同一安全儲存來源。
- [x] 新增安全遷移／失敗保留／清除測試；`pnpm mobile:sync`、Android debug build、
  iOS simulator build、Simulator 安裝啟動與 iOS signed Release archive 均成功。
- [ ] 相機、相簿、錄音、播放與繁中語音建卡正常。
- [ ] 權限拒絕後不崩潰，重新授權可恢復。
- [ ] 背景／前景、斷網、重啟與低儲存空間不遺失 board。
- [x] App 內 title 使用候選 JSON 值 `定恆人工智能`。
- [ ] Web ↔ Mobile 多人指派、Board revision 與附件最終收斂。

## P0-5：production cutover

### 前置條件

- staging 上述清單全部通過並記錄證據。
- multi-project migration、legacy alias、個人 token 與角色授權均已通過 staging。
- 正式站規劃為 `kanban.wongchamber.com`（zone 已在 Cloudflare）：cutover 時另建
  production Worker（與 `kanban-beta` 分離）、掛 custom domain，並決定 Access
  白名單或公開登入策略。
- 準備 production token 發放與撤銷名單。
- 決定行動版版本號、build number、簽章與回退版本。

### 嚴格發布順序

1. 記錄目前 production Worker deployment/version。
2. 取得 production D1 Time Travel bookmark，另存完整 D1 export。
3. 確認 production migration 狀態與預期一致。
4. 建立 private `kanban-attachments` production R2。
5. 部署 production Worker。
6. 先驗證既有 3a `/board` GET、PUT、401 與 409 行為。
7. 再驗證 3b attachment PUT、GET、DELETE、404、413 與錯誤 envelope。
8. 建立 production Web Worker 並掛 `kanban.wongchamber.com`，發布 production Web/PWA version。
9. 驗證 Web/PWA、分享 metadata、客製 title、離線啟動與 service worker 升級。
10. 在相同 release commit 上執行 final mobile sync、簽章與實機 smoke test。
11. 逐步發放，持續觀察 Worker errors、D1/R2 用量及同步失敗率。

### Rollback 原則

- Worker rollback 只回退程式與 bindings，不會還原 D1/R2 狀態。
- migration 必須採向前、向後相容方式；資料修復與程式 rollback 分開處理。
- D1 restore 是覆寫資料庫的事故操作，執行前必須保存當下 bookmark。
- R2 已寫入或刪除的物件不會隨 Worker rollback 自動還原。
- 保留上一個穩定 sync Worker version、Web Worker version 與行動版安裝包。

### 立即停止條件

任一步出現以下情況，就停止後續發布：

- 3a board GET/PUT/409 行為改變。
- migration 狀態與預期不同。
- R2 upload/download/delete 任一不一致。
- 雙裝置 board 或附件無法最終收斂。
- logs 出現 token、附件內容或大量未處理例外。
- Web/PWA 新版無法在線或離線啟動。
- title 設定造成空白頁、快取循環或原生 App 啟動失敗。

## P1：維運與後續改善

這些工作不阻擋 staging，但應在正式擴大使用前完成：

- 人力甘特圖下一階段：在甘特圖上直接拖拉與拉伸條子調整每人投入期間（v1 刻意只在卡片
  面板填寫，甘特圖純檢視）。實作前必須先處理：跨專案寫入時每張卡各自的 revision 樂觀鎖、
  拖拉的樂觀更新與失敗回滾、多裝置卡片級 LWW 下的誤操作風險，以及「只有 Project owner
  可改指派與期間」的權限在拖拉路徑上同樣要成立。
- 撰寫 token 新增、撤銷、輪替、裝置遺失與成員離開 runbook。
- 撰寫 D1 bookmark/export/restore、Worker rollback 與事故通報 runbook。
- 定義 staging 定期重設流程，同步清除 D1 board 與 R2 objects，避免失效參照。
- 建立 R2 orphan 掃描與保守清理流程。
- 對 Worker 5xx、同步失敗率、D1/R2 用量建立監控與告警。
- 評估 token rate limit；保留 CORS `*` 時記錄其理由與風險。
- 合併殘餘邊界：勝方已滿 20 欄且敗方有非空獨有欄時，「欄數上限」與「前版非空欄
  不得消失」互斥，推送會被拒但卡片不遺失、可刪欄自癒；徹底解需 Worker 放寬
  已清空欄位的刪除判定。
- 部署多看板與看板指派 v1 時必須先執行 `pnpm sync:migrate:staging` 套用 migration
  `0005`，再部署 Worker；順序顛倒會讓建立第二個看板誤報 `board_id_conflict`。
- 看板指派 API 目前允許對 owner／viewer 目標寫入指派列（resolution 會忽略，不影響
  實際可見性），但 GET 仍回傳這些殭屍列，可能誤導管理 UI；應改為對非 contributor
  目標回 400。
- `logJson` 剔除不可見看板名稱依賴已知鍵名黑名單，未來新增其他鍵名的 project-level
  事件會繞過遮蔽而洩漏看板名稱；應在 `audit.ts` 訂出遮蔽鍵名的命名約定並集中驗證。
- owner 建立看板失敗時對話框會直接關閉、輸入的名稱不會保留（Task 9 審查已知取捨，
  banner 疊在內容上方、modal 開著會蓋住它）；`name_conflict` 目前也只顯示泛用
  錯誤訊息，未提示「看板名稱重複」，應一併改善。
- member 僅被指派到已封存看板時目前不會自動落板，專案總覽文案也可能誤導；需補上
  archived-only 指派情境的落板與文案處理。
- 行動版 build 6 仍載有舊版 mergeBoards（欄位聯集修正前）與單看板 UI；下一次
  mobile build（build 7）需同時帶入 `100260a` 的合併修正與本次多看板與看板指派
  v1，在此之前手機端合併仍可能丟棄另一側新增的欄位，且原生 App 不會出現多看板
  切換與指派介面。
- 在獨立 PR 更新 Wrangler、Workers types 與 compatibility date；不要和 production
  cutover 放在同一個不可拆部署。人力甘特圖 v1（Task 7）已定位具體阻塞點：本機釘死的
  `wrangler@4.92.0`／`workerd@1.20260515.1` 最高只支援 compatibility date 約
  2026-05-22，專案目前設定已到 `2026-08-07`，`pnpm dev` 因此在本機無法啟動；真實部署
  不受影響（`wrangler deploy` 打 Cloudflare 正式 edge，不受本機執行期版本限制），僅本機
  開發體驗受阻，本分支刻意不在此處升版。
- 若需要已安裝 App 即時更新 title，設計具完整性驗證、cache fallback 與版本欄位的
  遠端設定服務。
- `/admin/users` 家族目前先解析路徑參數（`parseUuid`）才檢查 `requireWorkspaceAdmin`，
  非 admin 使用者可用 400（格式錯誤）與 404（找不到）的差異，探知 `/password`、
  `/projects` 等子路徑是否存在；屬既有模式、非本次新增，建議一併調整驗證順序。
- 平台管理指派專案成員的放寬路徑（`authorizeMembershipManagement`）目前只有讀碼確認
  或審查時的臨時手動測試，缺少正式 automated test 釘住：跨 workspace 隔離
  （workspace A 的 admin 不能指派 workspace B 專案成員）、混合身分格（同一使用者是
  專案 contributor 又是 workspace owner／admin，應放行且標 `via: "platform_admin"`）、
  以及 workspace owner（非 admin）身分的放寬路徑，目前只用 admin persona 測過。
- 規格 §6「放寬不外溢」目前只有 1 個 Worker 測試斷言（`GET` 看板詳情對未加入專案的
  admin 仍回 404）；`PUT` 看板內容、附件與 Activity Log 端點尚未有對應的 admin-404
  斷言，日後若不慎把放寬套用到這些端點不會被現有測試發現。
- `AdminUserProjectsModal` 初次載入失敗時，「讀取中…」與錯誤訊息會同時顯示
  （`memberships` 維持 `null` 觸發讀取中文案，`error` 已另外設定）；應在載入失敗時
  改用專屬的失敗狀態，不再顯示讀取中。
- 日曆側欄「每人本月件數」同件數 tie-break 排序沿用 `assigneeLoad`
  （`app/projects/calendar-model.ts`）內部裸短 ID 的 `localeCompare`，但畫面改用
  `nameOf` 加上「已離開 (短ID)」前綴顯示（`CalendarView.tsx`）；同件數且其中至少一人
  已離開 workspace 時，顯示順序可能與畫面文字的字母序不完全對齊。Task 4／5 審查已
  兩次判定維持現狀（純外觀，不影響件數與資料正確性），記錄於此以免長期遺忘；如需
  修正應在呼叫端處理，不動 `assigneeLoad` 已定案的排序邏輯本身。
- `worker-sync/src/calendar.ts` 的 `MAX_SCHEDULED = 5000` 只是防禦性上限，規格只要求
  `unscheduledTruncated`／`boardsTruncated` 兩個旗標，未涵蓋 scheduled 卡量；50 個看板
  皆逼近該上限的極端資料下會靜默截斷本月卡片且不提示。目前規模下發生機率低，應評估
  是否補一個對應旗標或告警，避免未來資料量成長後無聲遺漏卡片。
- `resolveCalendarScope`（`worker-sync/src/calendar.ts`）中 workspace admin／owner 但該
  workspace 無任何 active 專案時應回 200 並帶空的 `scheduled`／`unscheduled`；此路徑
  目前無對應 Worker runtime test 鎖住，建議補上，避免日後改動把「空結果」與
  403/404 邊界弄混。
- 日曆 top-50 看板依 `boards.updated_at DESC, boards.id DESC` 排序，現有測試只驗證
  「取滿 50 個、distinct board 數為 50」，未驗證「取的確實是最近更新的 50 個」；建議
  補一個混合新舊 `updated_at` 的測試，斷言被截斷排除的是較舊看板，鎖住排序規則本身
  而非只鎖數量。
- `worker-sync/src/calendar.ts` 的 `projectIds` 與 assignee 目錄查詢都把清單展成 `IN (?, …)`
  且未分批；D1 單一查詢的 bind 參數上限是 100，因此同一 workspace 有 100 個以上 active
  專案、或單月出現 100 位以上不同指派人時，整個日曆請求會直接失敗（fail loud，不會靜默
  少資料）。目前規模安全，建議與上一則 `MAX_SCHEDULED` 護欄併為同一件處理：分批查詢或
  明確上限＋旗標。
- 日曆入口的可見判斷（`canViewCalendar`）看的是跨 workspace 的全部 project memberships，
  但送出請求用的 workspace 由 `calendarWorkspaceId` 挑（admin workspace 優先，否則
  `workspaces[0]`）。使用者同時屬於多個 workspace、且他 own 的專案不在被挑中的那個
  workspace 時，會出現「導覽看得到日曆入口，但 API 回 403」——畫面顯示權限不足訊息，
  不會壞版也不洩漏資料。目前部署只有單一 default workspace（migration 只建一個），
  此路徑不可達，規格 §6 亦明文排除跨 workspace；若日後真的支援多 workspace，
  必須讓 `ProjectSummary` 帶 `workspaceId` 並改成依 owned 專案反推 workspace。
- 日曆 SQL 的 `cards.type = 'object'` 守門只能過濾「`$.cards` 底下的成員」是 scalar 的情形；
  若 `$.cards` 本身是字串，`json_each` 在展開階段就會拋 malformed JSON，守門救不了。
  該形狀目前由寫入端 `isBoardPayload`（`worker-sync/src/logic.ts`，要求 cards 為非陣列物件）
  以 400 擋下，createBoard／seed／migration 也都只產物件 map，因此不可達；記錄於此是因為
  這條防線在寫入端而非讀取端，日後放寬 board payload 驗證時必須一併檢查日曆查詢。
- 日曆與人力甘特圖的 workspace 範圍讀取（`GET /calendar`：admin 可看到全 workspace
  所有 active 專案的卡片標題、截止日與指派人；`GET /assignments`：admin 可看到全
  workspace 所有人的投入期間全景）目前都只在錯誤時寫 log，成功讀取不留任何可歸因的
  稽核紀錄；而「平台管理指派專案成員」的自我指派會留 `via: "platform_admin"`。兩者
  疊加的結果是「偵察無痕、加入留痕」（人力甘特圖 v1 審查時將範圍由 `/calendar`
  擴大到 `/assignments`——它揭露的是整個 workspace 的人力配置全景，資訊粒度比日曆
  更細，不只是單月卡片）。評估後不視為阻擋（放寬前 admin 已能經 `/admin` 家族列舉
  全部專案與成員，這兩個端點只是把粒度細化到卡片與人員層級，且敏感內容仍在稽核牆
  後），但建議補一筆輕量 audit 或存取計數，讓管理者的跨專案讀取也可回溯。
- 部署人力甘特圖 v1 時必須先 `pnpm sync:deploy:staging`（Worker 要先能驗證並接受
  `assignmentWindows`，否則 v8 client 送上的新欄位會被舊 Worker 原樣存入而未經驗證），
  再 `pnpm web:deploy:beta`；部署順序不可顛倒。部署後須確認：無 token 對 `/assignments`
  回 401、member 帳號改指派得 403、且舊看板的 member 編輯仍得 200（lockout 回歸的線上
  確認，即流動度量 v7 上線前抓到的同一坑，本次沿用同一防線）。
- **混版警告（本次唯一的掉資料路徑）**：全分支最終審查實測確認，Web Beta 發布後若有
  裝置停在未重新載入的舊分頁（v7 client）操作已排期的 v8 board：member 編輯得 403
  （指派簽章比對擋下，fail-safe），但 **owner 編輯得 200，且該 board 全部
  `assignmentWindows` 被靜默抹除**（v7 client 不認得這個欄位，儲存時整份覆蓋不會
  保留）。因此 Web Beta 發布後，管理者裝置必須重新載入頁面才能開始排期，否則舊分頁
  的 owner 儲存會把剛排好的投入期間洗掉而不會有任何錯誤提示。
- `tests/board-flow-metrics.test.ts` 在 `TZ=Pacific/Niue`（UTC-11）下有一個既有測試
  失敗：`monthly flow stats compute cycle time and flag unmeasured cards`（該檔案
  第 250 行斷言，`0 !== 1`）。人力甘特圖 v1 實作時（Task 5）順手發現，Task 8 複驗
  仍可重現，已確認與本次改動無關，屬先前 schema 的既有時區換算缺陷，應獨立排查
  月份／日界線在極端負時區下的計算。
- 指派人數 UI 目前無 20 上限提示（多看板指派 v1 遺留缺口，人力甘特圖 v1 審查時再次確認
  仍未補）：超過 20 位成員的專案勾選第 21 位指派人時，UI 無事前守門，要等 sync 才會吃
  Worker 400 `invalid_assignees`；應在勾選 UI 加上到 20 即停用其餘 checkbox 並提示上限。
- Worker 端 `DATE_ONLY`（`worker-sync/src/boards.ts` 寫入端、`worker-sync/src/assignments.ts`
  讀取端同一顆正則）只驗格式不驗曆法，`2026-13-45` 這類數字範圍合法但曆法不存在的日期可以
  直接存進 `assignmentWindows`。`/assignments` 讀取端已對此做縱深防禦（視為未排期，不會
  500 或算出 NaN 座標），但寫入端仍會落庫；應評估是否值得在 `normalizeAssignmentWindows`
  加一次來回驗證（比照 `app/projects/resource-model.ts` 的 `isValidDay`）。
- 卡片 `title` 或 `cardId` 為空字串、缺席或型別不對時，`/assignments` 的 `bars`
  （`toBar`）與 `unscheduled`（`unscheduledFromRow`）現在都會對稱跳過該筆，兩側
  一致消失、不會出現空標題項——**此為修正後的行為，先前記錄誤判為「可接受的設計
  取捨」，實際上 `unscheduled` 側原本沒有守門，是真正的故障，不是靜默消失**：
  title 缺席且同卡有 ≥2 位未排期指派人時，`unscheduledAll.sort` 對 null 呼叫
  `localeCompare` 會讓整個 `/assignments` 請求 500；title 為數字或空字串（≤1 位
  未排期指派人、`sort` 比較函式未被呼叫）則會讓非字串洩漏進回應，client 端
  `parseResourceUnscheduledItem` 解析失敗、整份回應變 `invalid_response`，甘特圖
  同樣全掛。全分支最終審查發現並修正，已補測試釘住
  （`worker-sync/test/assignments.integration.test.ts`）。
- `worker-sync/src/board-diff.ts` 的 `sameValue` 對鍵順序敏感；人力甘特圖 v1 新增的
  `assignmentWindows` 沿用同一函式比對變更偵測，繼承既有的 `assigneeUserIds` 同款限制
  （鍵順序不同但內容相同時，Activity Log 可能誤記一次「變更」）。只影響 Log 精度，不
  影響實際資料或權限判斷。
- 部署看板時間軸魚骨圖 v1 時必須先 `pnpm sync:deploy:staging`（Worker 要先能驗證並接受
  `parentCardId`，否則 v9 client 送上的新欄位會被舊 Worker 原樣存入而未經驗證），再
  `pnpm web:deploy:beta`；部署順序不可顛倒。部署後須確認：無 token 對 `/me` 回 401、
  舊看板的 member 編輯仍得 200（lockout 回歸的線上確認）、member 改上層任務得 200、
  member 改指派仍得 403。
- **混版警告**：v8 及更早的客戶端送出的 board 不含 `parentCardId`；該欄位由 Worker
  「缺席即通過」放行、client 端 `normalizeCards` 對缺席補 `null`，因此舊客戶端的編輯會把
  該看板**全部的上層任務關聯清空**（與甘特圖 v8 的投入期間、日曆的 schema 升級同型錯誤）。
  Web Beta 發布後使用者裝置必須重新載入頁面；行動版須盡快跟上此次 schema v9，在新版安裝前
  不要用舊 App 編輯卡片。
- 接點取 `startedAt`，語意是「卡片首次離開第一欄」。若團隊習慣是卡片建立後很久才移動，
  魚骨圖上的啟動時點會比真實開工晚。這是既有欄位語意，非本功能缺陷。
- `normalizeCardHierarchy` 的深度修正以字典序走訪，超長鏈被截斷的是「排序在前」的那張卡，
  而非最深的那張。結果決定且幂等，但不一定符合直覺；若日後要改成「從最深處截斷」，
  需同時更新 `assertBoardInvariants` 的測試。實務上最常見的觸發情境是繞過 UI 硬塞違規
  父卡（例如兩台裝置併發把不同子樹接到同一張卡上，合併後才發現超深）：normalize 不會
  拒絕那次編輯，而是斷開子樹中的某一張卡——多為造成當時違規的那張本身，但不保證是鏈尾
  最深的那張。多裝置合併若組出違規樹，修復語意是「犧牲某張卡的上層任務連結」，不是
  「拒絕那次合併」。
- **既有缺陷、未修**：`updateCard`／`deleteCard`／`moveCard`／`toggleChecklistItem`
  （`app/board-model.ts`）與 `BoardApp.tsx` 內多處 UI 讀取（附件面板、刪除確認訊息、
  標題回填等），仍是 `board.cards[cardId]` 形式的存在性判斷，而非 `Object.hasOwn`。
  可達性需疊加「遠端注入原型屬性名（如 `constructor`）id 的卡」與「stale-id race」，
  後果是單次操作 TypeError 或垃圾卡復活，嚴重度低於本次已修的 `merge.ts` placement 路徑。
  根治方向：讓 `normalizeCards` 以 `Object.create(null)` 建 cards record（無原型，所有
  bracket 查找天生安全），但需一併檢查 `cloneBoard` 等處的 `{ ...cards }` 展開會不會重新
  引入原型。**不要**用「限制卡片 id 格式」堵——demo board 自帶 `card-roadmap` 這類 id，
  且 `constructor` 本身符合一般字元白名單。
- **既有缺陷、未修**：`JSON.parse` 可造出 `"__proto__"` 自身鍵，而 `normalizeCards`／
  `normalizeDeletedCards`／`board-diff` 的「重建物件再賦值」寫法對這個 key 會觸發 setter，
  造成該卡靜默丟棄＋物件實例原型局部污染（非全域、不 crash）。`Object.hasOwn` 對這一類
  無效，是與上一則「讀取誤判存在」不同的缺陷類別，需要獨立的修復手段（例如用
  `Object.keys`／`Map` 取代直接展開賦值，或建構後以 `Object.hasOwn` 過濾 `__proto__` 鍵）。
- Worker 從未驗證 `column.cardIds` 是否對應存在的卡片——不是驗證被繞過，是根本沒有這道
  驗證。補這道驗證也擋不住上述兩則原型污染類問題，因為毒卡本身是 id 合法的真實卡片；
  新增前應先以 production 資料佐證是否真的出現過孤兒 `cardIds`，避免誤傷現存 D1 資料。
- `MAX_CARD_DEPTH` 在 `app/board-model.ts` 與 `worker-sync/src/boards.ts` 各自維護一份
  常數 `3`，只靠註解宣告一致、沒有機制強制同步；日後調整上限必須記得兩處都改。
- 魚骨圖的日期刻度**永不顯示年份**，最早開工日超過一年前的看板會出現兩個無法區分的月
  標籤（卡面本身的日期標籤有完整年月日可補救，不算資料遺失，僅刻度易讀性）。
- `#/…/boards/:bid/timeline` 這條 5 段路由分支（`app/projects/navigation.ts`）的兩個
  `isServerResourceId` 防護，以及 `timeline-model.ts` 的 `unstartedCards` 排序鍵第二層
  tie-break（`id`），目前都沒有測試直接鎖住——前者程式本身正確，純屬回歸網缺口；後者
  現有 fixture 的 `createdAt` 序與 `id` 序恰好一致，未真正走到 tie-break 分支。
- `tests/board-attachments.test.ts`、`board-tombstones.test.ts`、`board-flow-metrics.test.ts`
  三個測試名稱仍寫舊 schema 版號（分別為「版本為 6」「版本為 6」「v7」）而斷言
  `BOARD_SCHEMA_VERSION` 為 9；`parsePersistedBoard` 也還沒有專屬直打 v2／v3 的版本白名單
  測試。兩者都是歷次升版遺留的既有缺口，非本次引入，僅記錄以免長期遺忘。

## 行動版發行工作

### 內部測試版

完整步驟見 [行動版發布 runbook](./docs/runbooks/mobile-release.md)（含升版號、
`pnpm mobile:sync`、iOS archive、`pnpm mobile:release:android` 簽章 AAB、AAB 驗證、
實機驗收與混版風險）。摘要：

1. 兩平台一起升 build number，並在 release commit 執行 final `pnpm mobile:sync`。
2. 確認沒有非預期變更 Xcode signing/team 或 Android signing 設定。
3. iOS 使用 `.xcworkspace` 建置 archive 並在實機測試。
4. Android 以 `pnpm mobile:release:android` 產出已簽章 AAB。
5. 驗證安裝升級與上一版回退。

### App Store / Google Play

仍需：

- 已註冊且固定的 bundle/application ID。
- iOS distribution certificate/profile、Archive、版本號與 build number。
- Android release keystore/signing config、AAB、`versionCode` 與 `versionName`。
- Privacy Policy、支援 URL、商店文案、截圖、分類與年齡分級。
- App Privacy / Google Play Data Safety 揭露：相機、相簿、麥克風、語音辨識、
  裝置檔案、Bearer token、D1 看板資料與 R2 附件。
- 存取撤銷與雲端資料刪除政策。

## 已知限制

- 刪除墓碑只保留 30 天；離線更久的裝置可能讓舊卡片復活。
- email/password session 是一般使用者入口；personal／legacy token 只保留管理、遷移與
  相容用途。裝置遺失或 token 外洩時仍需人工撤銷換發。
- 附件 queue 保證跨重啟保存，並在 App 啟動、上線、回前景、資料變更或手動同步時
  重試；它不是 iOS/Android 的永久背景傳輸程序。
- JSON title 可在 Web 啟動時重新讀取；原生已安裝 App 的 bundled JSON 與桌面名稱
  仍受 App build 限制。
- 本機自動化通過不能取代 staging 雙裝置、實機與 production smoke test。
- 跨專案日曆以卡片 `completedAt` 是否為 null 判斷是否顯示；pre-v7（無 `completedAt`
  欄位）的舊 board 資料會被視為未完成卡而出現在日曆中，此為先前 schema 決議下已知的
  資料品質現象，非本次功能缺陷，亦不影響月報既有的 `completedAt` 計算。

## 剩餘工作建議時程

| 階段 | 估計 |
| --- | --- |
| 多角色、雙裝置、附件、離線與 Web/PWA 驗收 | 2–3 天 |
| TestFlight／Android internal track 與 release signing | 1–2 天 |
| production 備份、cutover 與觀察 | 1 天 |
| 商店資料、簽章與審核 | 另案估算 |

## 官方參考

- Cloudflare Workers 設定：<https://developers.cloudflare.com/workers/wrangler/configuration/>
- Workers environments：<https://developers.cloudflare.com/workers/wrangler/environments/>
- D1 migrations：<https://developers.cloudflare.com/d1/reference/migrations/>
- D1 Time Travel：<https://developers.cloudflare.com/d1/reference/time-travel/>
- R2 Workers API：<https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- Workers rollback：<https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
