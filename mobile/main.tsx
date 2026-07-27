import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectApp } from "../app/components/projects/ProjectApp";
import { PlatformProvider } from "../app/platform/context";
import { capacitorCapabilities } from "../app/platform/capacitor";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider capabilities={capacitorCapabilities}>
      <ProjectApp />
    </PlatformProvider>
  </StrictMode>,
);
