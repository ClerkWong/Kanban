import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Mobile 入口是純靜態 client bundle（Capacitor webDir 用），
// 與 vite.config.ts 的 vinext/Cloudflare web 建置完全分離。
export default defineConfig({
  root: "mobile",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/mobile", import.meta.url)),
    emptyOutDir: true,
  },
});
