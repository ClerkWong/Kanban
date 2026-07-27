import { SYNC_CONFIG_KEY_V2 } from "../projects/storage";

export type SyncConfig = { baseUrl: string; token: string };

const LEGACY_CONFIG_KEY = "kanban-sync-config-v1";
const REVISION_KEY = "kanban-sync-revision-v1";

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("同步伺服器網址格式不正確。");
  }
  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("同步伺服器必須使用 HTTPS；只有本機開發可使用 HTTP。");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("同步伺服器網址不可包含帳密、查詢參數或片段。");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("同步伺服器網址不可包含額外路徑。");
  }
  return parsed.origin;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw =
      window.localStorage.getItem(SYNC_CONFIG_KEY_V2) ??
      window.localStorage.getItem(LEGACY_CONFIG_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const parsed = value as Record<string, unknown>;
    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.token !== "string" ||
      !parsed.baseUrl ||
      !parsed.token
    ) {
      return null;
    }
    const config = { baseUrl: normalizeBaseUrl(parsed.baseUrl), token: parsed.token };
    if (!window.localStorage.getItem(SYNC_CONFIG_KEY_V2)) {
      window.localStorage.setItem(SYNC_CONFIG_KEY_V2, JSON.stringify(config));
      window.localStorage.removeItem(LEGACY_CONFIG_KEY);
    }
    return config;
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig | null): void {
  if (config) {
    window.localStorage.setItem(SYNC_CONFIG_KEY_V2, JSON.stringify({
      baseUrl: normalizeBaseUrl(config.baseUrl),
      token: config.token,
    }));
    window.localStorage.removeItem(LEGACY_CONFIG_KEY);
  } else {
    window.localStorage.removeItem(SYNC_CONFIG_KEY_V2);
    window.localStorage.removeItem(LEGACY_CONFIG_KEY);
    window.localStorage.removeItem(REVISION_KEY);
  }
}

export function loadSyncRevision(): number {
  const raw = window.localStorage.getItem(REVISION_KEY);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function saveSyncRevision(revision: number): void {
  window.localStorage.setItem(REVISION_KEY, String(revision));
}
