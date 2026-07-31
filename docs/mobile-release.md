# Mobile 內測簽章與實機驗收

本文件只涵蓋內部測試產物。執行任何 production 發布、TestFlight 上傳或 Google Play
上傳前，仍須依 `NextTasks.md` 的 production gate 另行確認。

## Android release signing

Keystore 不得放入 repository。若尚未建立，請在 repository 外執行 `keytool
-genkeypair`，互動輸入密碼，並妥善備份 keystore 與 alias。

建置前在目前 shell 或 CI secret store 設定：

```sh
export KANBAN_ANDROID_KEYSTORE_PATH="/absolute/private/path/kanban-release.jks"
export KANBAN_ANDROID_KEYSTORE_PASSWORD="..."
export KANBAN_ANDROID_KEY_ALIAS="..."
export KANBAN_ANDROID_KEY_PASSWORD="..."
```

產生內測 AAB 與 APK：

```sh
cd android
./gradlew :app:bundleRelease :app:assembleRelease
```

Gradle 在任何 release task 開始前會檢查四個變數；缺少任一值即停止，不會留下可被
誤認為正式產物的 unsigned release。完成後用 `jarsigner -verify -verbose -certs`
驗證 AAB，並用 Android SDK `apksigner verify --verbose --print-certs` 驗證 APK。

## iOS signing

固定使用 `ios/App/App.xcworkspace`，不要直接開 `.xcodeproj`。目前 bundle ID 為
`com.wongchambers.kanban`，Xcode target 採 Automatic signing，team 為
`Z247G8X22D`。

先確認 identity：

```sh
security find-identity -v -p codesigning
```

在 Xcode 選實機、確認 Signing & Capabilities 沒有 profile 錯誤，再建立本機
Archive。若需要 TestFlight，上傳是獨立的外部發布步驟，不包含在本文件的建置命令
內。

## 實機 smoke test

至少使用一台 iPhone/iPad 與一台 Android 裝置，記錄 OS、app build、測試帳號角色、
staging endpoint、開始與結束時間。不得使用 production endpoint。

- personal token 首次登入；確認重啟後仍可登入，WebView localStorage 不再留 token。
- 從舊版升級；確認 token 一次性遷移後，Board 與 Attachment queue 不被清除。
- 登出／停用同步；確認 Keychain/Keystore token 已清除，本機 Board 仍存在。
- manager、contributor、viewer 的多人指派與唯讀限制。
- 照片、相簿、錄音、播放、繁中語音建卡，以及拒絕後重新授權。
- 斷網冷啟動、背景／前景、強制關閉後重啟。
- Web ↔ Mobile 的 Board revision、多人指派與附件最終收斂。
- 安裝升級與上一版回退；若回退版本不理解安全儲存，必須記錄需重新輸入 token。

所有 smoke evidence 應附在 `docs/reports/`，包括失敗步驟、畫面、裝置 log，以及是否
需要撤銷測試 token。
