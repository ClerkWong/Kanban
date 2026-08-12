import type { CapacitorConfig } from "@capacitor/cli";

// 兩個平台的應用程式身分刻意不同，且以原生專案檔為權威來源：
//   iOS     PRODUCT_BUNDLE_IDENTIFIER = com.wong-chambers.WongKanban（ios/App/App.xcodeproj）
//   Android applicationId             = com.wongchamber.WongKanban（android/app/build.gradle）
// Android 套件名遵循 Java 識別字規則、不允許連字號，因此無法與 iOS 完全一致。
// Capacitor 的 config 只有單一 appId 欄位，且該值僅由 CLI 使用——iOS 與 Android
// runtime 都不讀取它，因此此處填 Android 值不影響任何平台的實際身分。
// `cap sync` 不會改寫原生專案的 bundle id 或 applicationId。
const config: CapacitorConfig = {
  appId: "com.wongchamber.WongKanban",
  appName: "定恆人工智能",
  webDir: "dist/mobile",
};

export default config;
