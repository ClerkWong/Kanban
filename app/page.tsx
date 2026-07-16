"use client";

import { BoardApp } from "./components/board/BoardApp";
import { PlatformProvider } from "./platform/context";
import { webCapabilities } from "./platform/web";

export default function Home() {
  return (
    <PlatformProvider capabilities={webCapabilities}>
      <BoardApp enableServiceWorker />
    </PlatformProvider>
  );
}
