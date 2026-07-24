export type SyncConfig = { baseUrl: string; token: string };

const CONFIG_KEY = "kanban-sync-config-v1";
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
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string" || !parsed.baseUrl || !parsed.token) {
      return null;
    }
    return { baseUrl: normalizeBaseUrl(parsed.baseUrl), token: parsed.token };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig | null): void {
  if (config) {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } else {
    window.localStorage.removeItem(CONFIG_KEY);
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
