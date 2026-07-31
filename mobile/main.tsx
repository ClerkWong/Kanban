import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlatformProvider } from "../app/platform/context";
import { capacitorCapabilities } from "../app/platform/capacitor";
import "../app/globals.css";
import { MobileApp } from "./MobileApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider capabilities={capacitorCapabilities}>
      <MobileApp />
    </PlatformProvider>
  </StrictMode>,
);
