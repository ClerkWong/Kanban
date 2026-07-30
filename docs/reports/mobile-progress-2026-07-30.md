# Mobile 進度與 Web 差距報告

- 日期：2026-07-30
- 基準 commit：`90e2677`（本次安全儲存與簽章變更尚待 commit）
- 平台：Capacitor 8 / iOS / Android
- 結論：核心產品功能已與 Web 共用，`1.1.0` 內測版的品牌資產、說明入口與雙平台
  編譯已完成；personal token 已移至 Keychain／Keystore-backed storage。現在主要
  缺口是 Android release keystore、iOS distribution export 與雙平台實機驗收。

## 目前完成度

### 共用產品功能

Mobile 入口直接掛載與 Web 相同的 `ProjectApp`，下列功能沒有另做簡化版：

- 我的專案、Project overview、Project／Board 管理與封存。
- manager／contributor／viewer 權限。
- 多 Board、per-Board local cache、revision 與同步。
- Card 新增、編輯、移動、完成、月報與附件。
- Project member 多人指派、離開成員保留與 viewer 唯讀。
- D1 Board 同步與 R2 Attachment queue。
- `app-config.json` 畫面 title；Mobile 以 bundled JSON 讀取。

### 原生能力

- iOS/Android Capacitor shell 與固定 application ID 已建立。
- iOS/Android 已套用與 PWA 相同的 Kanban icon 與 splash；來源保存在 `assets/`，
  可用 `pnpm mobile:assets` 重新產生。
- Mobile 內建可離線讀取的支援／隱私面板，內容與 Web 頁面共用。
- 內測版本為 iOS `1.1.0 (2)`、Android `1.1.0 (versionCode 2)`。
- iOS 已設定相機、相簿、麥克風與語音辨識權限文案。
- Android 已設定 Internet、錄音權限與 Speech Recognition query。
- 相機／相簿：`@capacitor/camera`。
- 附件：`@capacitor/filesystem`，寫入 App data directory。
- 錄音：`capacitor-voice-recorder`。
- 繁中語音建卡：`@capacitor-community/speech-recognition`，locale `zh-TW`。
- personal token：iOS Keychain
  (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`)；Android 以 Android Keystore
  device-bound AES-GCM key 加密後存入 private SharedPreferences。
- 原生 App 會把既有 WebView localStorage token 一次性遷移到安全儲存；安全寫入失敗
  時不使用也不刪除舊 token，避免靜默遺失。

### 2026-07-30 驗證

- `pnpm mobile:sync` 成功，四個插件均同步到 iOS/Android。
- 同步後兩個 native bundle 都包含「任務負責人（可複選）」。
- Android `:app:assembleDebug` 成功，產出約 9.5 MiB 的 debug APK。
- iOS `.xcworkspace`、Debug、generic iOS Simulator、未簽章 build 成功。
- Web/mobile build、159 個 client tests、49 個 Worker tests、8 個 release tests、
  lint 與 typecheck 已在同一功能版本通過。
- 品牌資產與 Mobile 支援／隱私面板加入後，再次通過 159 個 client tests、lint、
  typecheck、Web/mobile build、Capacitor sync、Android debug build 與 iOS simulator
  build。
- `1.1.0` 已實際安裝並啟動於 iPhone 17 Pro / iOS 26.5 Simulator，確認原生 launch、
  本機 Board 首畫面與 Mobile「說明」入口可呈現。另加入 bundle 載入中的靜態畫面，
  避免 splash 結束到 React 首次繪製間只顯示空白。
- Android debug APK 約 9.5 MiB，可供受控內部裝置安裝測試。
- 安全儲存變更再次通過 typecheck、lint、mobile build、完整 `pnpm mobile:sync`、
  162 個 client tests、Android `:app:assembleDebug` 與 iOS generic simulator build。
- 新 bundle 已安裝並啟動於 iPhone 17 Pro / iOS 26.5 Simulator，確認自訂 iOS
  ViewController 與 SecureConfig plugin 註冊後 App 可正常啟動。
- 本機目前有有效 Apple Development 與 Apple Distribution identity；iOS Release
  generic device build、本機 archive 與 `codesign --verify --deep --strict` 成功。
  Archive 目前使用 Apple Development + team provisioning profile，尚未執行
  distribution export 或 TestFlight 上傳。
- Android release signing 已接好環境變數與 fail-closed gate，但尚無 release
  keystore，因此沒有產出或宣稱 release-signed AAB／APK。

## 與 Web/PWA 的差距

| 面向 | Web/PWA | iOS/Android | 差距／下一步 |
| --- | --- | --- | --- |
| 核心 Project／Board／多人指派 | 已發布前一版 private beta；新功能待再發布 | 同一套 UI 已進 bundle | 兩端都要部署/安裝 v1.1 後做三角色驗收 |
| 離線啟動 | Service worker + browser storage | App 內建本地 bundle + WebView localStorage | 原理可用，仍缺斷網冷啟動與升級實測 |
| 照片／錄音／附件 | Browser API + IndexedDB | 原生插件 + Filesystem | Mobile 能力較完整，但仍缺實機權限與檔案生命週期驗收 |
| 語音建卡 | Web 不提供，按鈕隱藏 | 原生繁中語音辨識 | Mobile 是功能優勢，尚未在本次 build 實機驗證 |
| Title 更新 | 網站重新發布 JSON，重啟即可取得 | JSON 包在 App bundle | Mobile 每次改 title 都要重新 sync、build、安裝 |
| 桌面 App 名稱 | PWA manifest 可隨發布更新 | Info.plist / Android resources 固定 | 不能由 runtime JSON 改名 |
| 隱私／支援頁 | `/privacy`、`/support` 網站頁面 | 已加入 bundle 內離線面板，並與 Web 共用內容 | 已補齊入口；擴大內測前仍需決定公開支援聯絡方式 |
| 品牌資產 | 網站已有 metadata / PWA assets | 已使用同一套 Kanban icon/splash | 已完成；仍待真機檢查各 launcher mask 與啟動畫面 |
| 版本／發行 | Sites 有版本與回退 | iOS/Android 已設為 `1.1.0 (2)` | 版本已建立；安裝升級與回退仍待實機驗證 |
| 發布管道 | private beta URL 已存在 | 尚無 TestFlight／signed APK／internal track | 需簽章、產物保存與內部分發 |
| Token 儲存 | browser localStorage | iOS Keychain／Android Keystore-backed AES-GCM | 原生實作與一次性遷移已完成；仍需實機驗證升級、重啟與停用同步 |
| 背景同步 | 開啟頁面或回前景時重試 | 啟動、上線、回前景時重試 | 沒有永久背景傳輸；大型附件需實機驗證 |

## Mobile 下一批工作

### M0：內部測試版前

1. 部署含多人指派驗證的 staging Worker。
2. 發布同 commit 的 Web beta，建立 Web ↔ Mobile 對照基線。
3. 決定第一個實機平台與測試裝置。
4. [x] 更換 Capacitor 預設 App icon 與 splash。
5. [x] 設定 iOS `1.1.0 (2)`、Android `1.1.0 (versionCode 2)`。
6. [x] iOS 本機 identity、Release device build 與 archive 已驗證；仍需 distribution
   export profile。另需提供 Android release keystore。
7. 產生可安裝的 release-signed internal build。
8. 完成以下實機 smoke：
   - personal token 登入與我的專案；
   - 多人指派與三角色唯讀／可編輯；
   - 照片、相簿、錄音、播放與繁中語音建卡；
   - 權限拒絕、重新授權；
   - 斷網冷啟動、背景／前景、重啟；
   - Web ↔ Mobile Board、指派與附件收斂。

### M1：擴大內測前

- [x] 將 personal token 移到 iOS Keychain / Android Keystore-backed storage。
- [x] 補 App 內隱私與支援入口。
- 驗證安裝升級與上一版回退，不清除 local Board 或 Attachment queue。
- 評估大型附件的背景傳輸策略。
- 準備 TestFlight 或 Google Play Internal Testing。

## 尚未宣告完成

- 模擬器 build 成功不等於實機原生能力已通過。
- debug APK 不等於可發行的 signed AAB／APK。
- iOS 本機 Archive 已成功，但目前以 Apple Development + team provisioning profile
  簽署；尚未驗證 distribution export、App Store Connect 或 TestFlight。
- Android debug APK 由 debug keystore 簽署，可供內部除錯安裝；它不是 release-signed
  AAB／APK。release task 已設為缺少 keystore secrets 即停止。
- 本次環境沒有可連線的互動瀏覽器，因此未完成 mobile viewport 的自動點擊驗收；
  已改以 iOS Simulator 實際安裝／啟動與截圖補足首畫面驗證，但說明面板操作與完整
  使用流程仍待實機或互動式 UI 測試。
