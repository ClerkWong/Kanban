export type SyncConfig = { baseUrl: string; token: string };

const CONFIG_KEY = "kanban-sync-config-v1";
const REVISION_KEY = "kanban-sync-revision-v1";

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("同步伺服器網址格式不正確。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("同步伺服器網址必須是 http(s)。");
  }
  return trimmed;
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
    return { baseUrl: parsed.baseUrl, token: parsed.token };
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
