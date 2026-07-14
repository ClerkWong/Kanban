# Kanban Mobile App 擴展 — 設計文件

日期：2026-07-14
狀態：已與使用者逐段確認

## 1. 目標與範圍

在現有 Kanban PWA（vinext / Next.js 16 + React 19 + TypeScript + Tailwind 4，client-side 狀態模型 + localStorage）之上，擴展為可側載的 iOS / Android app，補齊三項裝置能力並升級為多裝置雲端同步：

- **卡片附件**：拍照、錄音，附加到卡片
- **語音快速建卡**：裝置內建語音辨識（繁中）即時轉文字建卡
- **雲端同步**：看板資料存 Cloudflare D1、附件存 R2，多裝置共用

### 明確不做（YAGNI）

- 不上 App Store / Google Play（側載 / TestFlight / APK 內部分發）
- 不用雲端 AI 轉寫（僅裝置內建辨識；長錄音逐字稿不在本次範圍）
- 不做註冊、OAuth、密碼重設（token 手動發放）
- 不做即時協作、推播、逐字稿搜尋

## 2. 技術路線決策

**採用 Capacitor 包殼**（`PRODUCT_PLAN.md` 第 5 節原定路線）。

評估過的替代方案：

| 方案 | 結論 |
| --- | --- |
| Capacitor | ✅ 採用 — UI 近乎全重用，原生插件補齊三項能力，成本最低 |
| React Native / Expo | ❌ 原生操作感最佳，但需重寫 915 行 UI 且長期維護兩套 UI |
| 純 PWA + Web API | ❌ 照相/錄音可行，但 iOS Safari 語音辨識支援殘缺，卡死核心需求 |

## 3. 整體架構

Capacitor 需要純靜態本地 web bundle，vinext（RSC）輸出無法直接使用。解法為**抽共用元件 + 雙入口建置**：

```
app/
  components/board/     # 看板 UI 自 page.tsx 抽出的共用元件
  platform/             # 平台能力抽象層（介面 + web / capacitor 實作）
  board-model.ts        # 純函式模型，原樣共用（含 v1→v2 遷移）
  page.tsx              # Web 入口（vinext，維持現狀）
mobile/
  index.html, main.tsx  # Mobile 入口：純 Vite + React，掛載同一套元件
capacitor.config.ts     # webDir 指向 dist/mobile
ios/  android/          # Capacitor 產生的原生專案
worker-sync/            # 獨立 Cloudflare Worker：同步 API（D1 + R2）
```

原則：

- 看板邏輯與 UI 只有一份；兩入口只差掛載方式與平台能力注入
- UI 元件不直接 import Capacitor 插件，一律經由 `PlatformCapabilities` 介面
- 拆解 `page.tsx`（915 行）為聚焦元件是必要前置重構，不是額外工程

## 4. 平台能力抽象層

```ts
interface PlatformCapabilities {
  takePhoto(): Promise<AttachmentFile | null>;
  recordAudio(): Promise<AttachmentFile | null>;
  speech: {
    available(): Promise<boolean>;
    start(locale: "zh-TW", onPartial: (text: string) => void): Promise<string>;
    stop(): void;
  };
}
```

| 能力 | Mobile（Capacitor） | Web fallback |
| --- | --- | --- |
| 照相 | `@capacitor/camera` | `<input type="file" capture>` |
| 錄音 | `capacitor-voice-recorder` | `MediaRecorder` |
| 語音辨識 | `@capacitor-community/speech-recognition`（iOS `SFSpeechRecognizer` / Android 原生，locale `zh-TW`） | 不提供 — 隱藏語音建卡入口 |

## 5. 功能設計

### 卡片附件

- 卡片編輯視窗新增「附件」區：拍照、錄音兩個動作；附件以縮圖（照片）/ 播放器（錄音）列表呈現，可刪除（需確認）
- `Card` 新增 `attachments: AttachmentRef[]`：`{ id, type: "photo" | "audio", fileName, size, createdAt }`
- `BOARD_SCHEMA_VERSION` 升至 2，`parsePersistedBoard` 寫 v1→v2 遷移；malformed 資料維持安全 fallback

### 語音快速建卡

- 每欄「新增卡片」旁加麥克風按鈕：按住說話 → 即時顯示辨識中間結果 → 放開後文字帶入卡片標題，可編輯後儲存
- 辨識不可用（權限拒絕、裝置不支援）時隱藏或停用按鈕並說明原因

### 權限處理

- 相機 / 麥克風 / 語音辨識權限於首次使用該功能時才請求
- 拒絕時顯示明確指引（前往系統設定開啟），功能降級、不崩潰

## 6. 雲端同步與認證

### 部署

現有站點部署於 OpenAI Workspace Sites，其 SIWC 認證走瀏覽器 cookie，原生 app 無法通過。因此**同步 API 部署為獨立 Cloudflare Worker（自有帳號）**，綁定 D1 + R2。網頁版與 app 打同一個 API。

### 認證

- Bearer token：D1 `users` 表（id、名稱、token hash），token 手動發給成員
- App / 網頁設定頁貼上 token，所有 API 請求帶 `Authorization` header

### 同步模型（離線優先）

- 本地為第一落點：app 用 Capacitor Preferences / Filesystem，網頁維持 localStorage；離線完全可用
- D1 存整份看板 JSON 文件 + `revision` 整數
- 推送帶 base revision：符合即寫入並 revision+1；不符則拉回遠端版本，以**卡片層級 `updatedAt` 做 last-write-wins 合併**後重推
- 同步時機：啟動、變更後 debounce、App 回到前景
- UI 常駐顯示同步狀態：已同步 / 待同步 / 失敗（可手動重試）

### 附件流

1. 拍照/錄音先寫本地檔案並掛上 `AttachmentRef` — 即時可用，不等網路
2. 背景上傳佇列（跨重啟持久化）經 Worker 上傳 R2，失敗自動重試；不由 client 直連 R2
3. 其他裝置看到 ref 後按需下載並快取本地；下載失敗顯示占位與重試
4. 刪除附件時移除 ref 並經同一佇列刪除 R2 物件；殘留孤兒物件可容忍（小團隊規模），不做垃圾回收機制

## 7. 錯誤處理原則

- 同步 / 上傳失敗一律可見、可重試；**絕不把未成功的寫入顯示為已儲存**（延續 PRODUCT_PLAN 驗收原則）
- token 無效（401）時提示重新設定 token，本地資料不受影響
- 語音辨識中斷（來電、切換 app）保留已辨識文字，不遺失輸入

## 8. 測試

- 單元測試（現有 `tsx --test`）：合併函式（revision 衝突 + 卡片級 LWW）、v1→v2 schema 遷移、附件 ref 增刪的狀態不變量
- Worker API：token 驗證、revision 檢查的整合測試
- 裝置驗收（實機）：相機、錄音、繁中語音辨識、離線冷啟動完整卡片流程、雙裝置同步收斂

## 9. 分階段交付

1. **殼**：重構共用元件 + mobile Vite 入口 + Capacitor 專案；裝上手機可跑（功能同 PWA）
2. **原生能力**：附件（本地儲存）+ 語音建卡
3. **雲端**：worker-sync API + D1/R2 + token 認證 + 同步引擎與上傳佇列

每階段獨立可驗收；階段 1、2 完成時 app 已可日常使用（單裝置），階段 3 帶來多裝置。
