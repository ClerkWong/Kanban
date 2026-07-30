# Mobile 進度與 Web 差距報告

- 日期：2026-07-30
- 基準 commit：`47f604f`
- 平台：Capacitor 8 / iOS / Android
- 結論：核心產品功能已與 Web 共用，`1.1.0` 內測版的品牌資產、說明入口與雙平台
  編譯已完成；目前主要缺口是實機驗收與 release signing。

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
- 本機沒有有效 iOS code-signing identity；Android 也還沒有 release keystore，
  因此本次沒有宣稱已產出 release-signed build。

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
| Token 儲存 | browser localStorage | WebView localStorage | 功能一致，但 Mobile 擴大使用前應改 Keychain／Keystore |
| 背景同步 | 開啟頁面或回前景時重試 | 啟動、上線、回前景時重試 | 沒有永久背景傳輸；大型附件需實機驗證 |

## Mobile 下一批工作

### M0：內部測試版前

1. 部署含多人指派驗證的 staging Worker。
2. 發布同 commit 的 Web beta，建立 Web ↔ Mobile 對照基線。
3. 決定第一個實機平台與測試裝置。
4. [x] 更換 Capacitor 預設 App icon 與 splash。
5. [x] 設定 iOS `1.1.0 (2)`、Android `1.1.0 (versionCode 2)`。
6. 匯入 iOS signing identity／provisioning profile，並提供 Android release keystore。
7. 產生可安裝的 release-signed internal build。
8. 完成以下實機 smoke：
   - personal token 登入與我的專案；
   - 多人指派與三角色唯讀／可編輯；
   - 照片、相簿、錄音、播放與繁中語音建卡；
   - 權限拒絕、重新授權；
   - 斷網冷啟動、背景／前景、重啟；
   - Web ↔ Mobile Board、指派與附件收斂。

### M1：擴大內測前

- 將 personal token 移到 iOS Keychain / Android Keystore-backed storage。
- [x] 補 App 內隱私與支援入口。
- 驗證安裝升級與上一版回退，不清除 local Board 或 Attachment queue。
- 評估大型附件的背景傳輸策略。
- 準備 TestFlight 或 Google Play Internal Testing。

## 尚未宣告完成

- 模擬器 build 成功不等於實機原生能力已通過。
- debug APK 不等於可發行的 signed AAB／APK。
- iOS 專案已有 development team 設定，但 Keychain 沒有有效 code-signing identity，
  本次無法做 distribution Archive 或 TestFlight。
- Android debug APK 由 debug keystore 簽署，可供內部除錯安裝；它不是 release-signed
  AAB／APK。
- 本次環境沒有可連線的互動瀏覽器，因此未完成 mobile viewport 的自動點擊驗收；
  已改以 iOS Simulator 實際安裝／啟動與截圖補足首畫面驗證，但說明面板操作與完整
  使用流程仍待實機或互動式 UI 測試。
