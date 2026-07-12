import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "本機 Kanban 看板",
  description: "離線可用、只存於本裝置瀏覽器的繁體中文 Kanban PWA。",
  manifest: "/manifest.webmanifest",
  applicationName: "本機 Kanban",
  appleWebApp: {
    capable: true,
    title: "本機 Kanban",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f5ef",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
