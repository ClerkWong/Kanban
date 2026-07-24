import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { bundledAppConfig } from "./app-config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const requestProtocol =
    requestHeaders.get("x-forwarded-proto") ??
    (requestHost?.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (requestHost
        ? `${requestProtocol}://${requestHost}`
        : "http://localhost:3000"),
  );

  return {
    metadataBase,
    title: bundledAppConfig.title,
    description: "離線可用、本機優先，並可選擇跨裝置同步的繁體中文 Kanban PWA。",
    manifest: "/manifest.webmanifest",
    applicationName: bundledAppConfig.title,
    openGraph: {
      title: bundledAppConfig.title,
      description: "離線可用、本機優先，並可選擇跨裝置同步的繁體中文 Kanban PWA。",
      type: "website",
      locale: "zh_TW",
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "本機 Kanban：離線優先、選用同步",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: bundledAppConfig.title,
      description: "離線可用、本機優先，並可選擇跨裝置同步的繁體中文 Kanban PWA。",
      images: ["/og.png"],
    },
    appleWebApp: {
      capable: true,
      title: bundledAppConfig.title,
      statusBarStyle: "default",
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/icon-192.png",
    },
  };
}

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
