"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { PlatformCapabilities } from "./types";

const PlatformContext = createContext<PlatformCapabilities | null>(null);

export function PlatformProvider({
  capabilities,
  children,
}: {
  capabilities: PlatformCapabilities;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={capabilities}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformCapabilities {
  const capabilities = useContext(PlatformContext);
  if (!capabilities) {
    throw new Error("usePlatform 必須在 PlatformProvider 內使用。");
  }
  return capabilities;
}
