import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BoardApp } from "../app/components/board/BoardApp";
import { PlatformProvider } from "../app/platform/context";
import { webCapabilities } from "../app/platform/web";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider capabilities={webCapabilities}>
      <BoardApp />
    </PlatformProvider>
  </StrictMode>,
);
