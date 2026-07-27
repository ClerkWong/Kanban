"use client";

import { ProjectApp } from "./components/projects/ProjectApp";
import { PlatformProvider } from "./platform/context";
import { webCapabilities } from "./platform/web";

export default function Home() {
  return (
    <PlatformProvider capabilities={webCapabilities}>
      <ProjectApp enableServiceWorker />
    </PlatformProvider>
  );
}
