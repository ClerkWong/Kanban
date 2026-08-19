# 行動版發布 Runbook

iOS 與 Android 發布候選的建置與分發。適用於 TestFlight 與 Play Console 內部測試軌道；
正式上架另受 production cutover 阻擋，見 [NextTasks.md](../../NextTasks.md)。

## 前置

| 項目 | 值 |
| --- | --- |
| iOS bundle ID | `com.wong-chambers.WongKanban` |
| Android applicationId | `com.wongchamber.WongKanban`（package name 不能含連字號，與 iOS 刻意不同） |
| Android upload keystore | `~/keys/wongkanban-upload.jks`（alias 由腳本自動偵測，不要手填） |
| JDK | openjdk@21。**不要用 Android Studio 內建的 JDK 25**，Gradle 會報 `Unsupported class file major version 69` |
| Android SDK | `~/Library/Android/sdk` |

keystore 與其密碼是發布憑證：遺失就無法再更新既有的 Play 應用。請確認已離線備份，
且密碼存在密碼管理員而非任何檔案或筆記裡。

## 1. 升版號

兩個平台的 build number 必須一起升，且與 `main` 上的 release commit 對應：

- iOS：`ios/App/App.xcodeproj/project.pbxproj` 的 `CURRENT_PROJECT_VERSION`（兩處都要改）
- Android：`android/app/build.gradle` 的 `versionCode`

`MARKETING_VERSION` 與 `versionName` 是對外版本號，內部測試通常不動。

## 2. 在 release commit 上重跑完整同步

```bash
LANG=en_US.UTF-8 pnpm mobile:sync
```

**不能沿用舊 bundle。** 原生專案的 web 資產（`ios/App/App/public`、
`android/app/src/main/assets/public`）是 git 忽略的建置產物，所以 `git status` 乾淨
不代表裡面是新的。`LANG` 必須設定，否則 CocoaPods 會拋 `Encoding::CompatibilityError`。

同步後確認兩邊資產都是新的：

```bash
ls -la ios/App/App/public/index.html android/app/src/main/assets/public/index.html
```

## 3. iOS archive

```bash
cd ios/App && LANG=en_US.UTF-8 xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath /tmp/WongKanban.xcarchive archive
```

預期結尾是 `** ARCHIVE SUCCEEDED **`。驗證產物：

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" -c "Print :CFBundleShortVersionString" -c "Print :CFBundleVersion" /tmp/WongKanban.xcarchive/Products/Applications/App.app/Info.plist
```

上傳走 Xcode → Window → Organizer → Archives → Distribute App → TestFlight & App Store。
archive 放在 `/tmp` 會被重開機清掉，要保留就先搬走。

## 4. Android AAB

```bash
pnpm mobile:release:android
```

腳本會提示 keystore 密碼（不回顯、不進 shell history），其餘自動處理：停掉 Gradle
daemon、用 keytool 讀出 keystore 的 alias、以簽章設定建置 `:app:bundleRelease`、
最後印出 AAB 路徑、大小與簽章者憑證。

- keystore 路徑可用 `--keystore <path>` 或 `KANBAN_ANDROID_KEYSTORE_PATH` 覆寫。
- 密碼**不接受**命令列參數，腳本會直接拒絕。CI 可用管線餵入：
  `printf '%s' "$PW" | pnpm mobile:release:android`。
- 產物在 `android/app/build/outputs/bundle/release/app-release.aab`。

上傳走 Play Console → 內部測試 → 建立新版本。首次上傳會把這把 key 註冊為 upload key；
若該應用先前已用另一把 key 註冊 Play App Signing，上傳會被拒。

### 簽章值為什麼走 project property

`android/app/build.gradle` 優先讀 Gradle project property（`kanbanKeystorePath`、
`kanbanKeystorePassword`、`kanbanKeyAlias`、`kanbanKeyPassword`），舊的
`KANBAN_ANDROID_*` 環境變數只是 fallback。

原因是 `--no-daemon` **仍然**會為了套用 JVM 設定 fork 一個 single-use daemon，
build script 裡的 `System.getenv` 讀到的是那個 daemon 的環境，命令列前綴設定的環境變數
會遺失，於是 release 建置誤報「Release signing is not configured」。
`ORG_GRADLE_PROJECT_<name>` 由 Gradle client 讀取後轉成 project property 傳給 daemon，
不受影響，而且不像 `-P` 會把密碼露在 `ps` 的參數列裡。

需要持久設定時，可寫進 `~/.gradle/gradle.properties`（在 repo 之外，權限限本人）。

## 5. 驗證 AAB

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 $JAVA_HOME/bin/keytool -J-Duser.language=en -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab
```

另外確認 web bundle 真的被包進去（檔名應與 `dist/mobile/assets` 內的一致）：

```bash
unzip -l android/app/build/outputs/bundle/release/app-release.aab | grep 'base/assets/public/assets/index-'
```

`aapt2 dump xmltree` 對 AAB 會回 `could not identify format of APK`——那個工具只吃 APK，
AAB 的 manifest 是 protobuf 編碼，要讀 versionCode 得自行解析或改用 bundletool。

## 6. 實機驗收

- 覆蓋安裝於既有版本之上，確認資料未遺失、可正常同步。
- 確認裝置回報的 build number 與本次發布一致。
- 日曆與人力甘特圖是**桌面專用**（< 900px 顯示引導訊息），手機上不會出現這兩個檢視；
  這是預期行為，不是缺陷。
- 指派名單與投入期間只有 Project owner 可改，member 在卡片面板看到的是唯讀並顯示
  「指派與排程由專案管理者負責。」。

## 混版風險

Card schema v8 之前的客戶端（mobile build 7 及更早）不認得 `version: 8`。
`parsePersistedBoard` 的版本白名單是明確列舉，遇到白名單外的版本一律判定為無法辨識；
讀取或推送已排期看板時，這個判定會在送出任何 PUT 之前就中止同步（多專案 API 路徑拋
`invalid_response`、legacy 單板路徑回 422「暫停同步以保護本機資料」），不論操作者是
owner 還是 member。效果是**同步斷線、本機編輯滯留**，不會發生投入期間被靜默覆蓋或
抹除——要能靜默覆蓋，舊客戶端得先成功讀懂 v8 board 再省略欄位存回，但它連讀都讀不過
這道版本檢查。（先前這裡記錄的是「owner 編輯會靜默抹除」，方向有誤，已更正；詳見
`NextTasks.md` P1 的修正說明。）

因此 Web Beta 發布 v8 之後：

1. 舊的 mobile build 對已排期看板會卡在同步錯誤，而非造成資料遺失；仍建議盡快更新，
   否則裝置會持續無法同步該看板。
2. 管理者裝置建議重新載入頁面，避免介面停在舊版而看不到新排期功能。
3. 行動版更新應盡快發出——這是恢復同步能力的更新，不是搶救資料完整性的更新。
