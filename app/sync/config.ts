import {
  SYNC_CONFIG_KEY_V2,
  loadBoardRevision,
  saveBoardRevision,
  syncRevisionKey,
  type StorageLike,
} from "../projects/storage";

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

/** Reads the old single-board revision at most once, and immediately moves it
 * into the active Board's v2 key. New sync code must only use per-board keys. */
export function loadBoardRevisionWithLegacyMigration(
  storage: StorageLike,
  boardId: string,
): number {
  if (storage.getItem(syncRevisionKey(boardId)) !== null) {
    return loadBoardRevision(storage, boardId);
  }
  const legacyRaw = storage.getItem(REVISION_KEY);
  const legacyValue = Number(legacyRaw);
  const revision =
    Number.isInteger(legacyValue) && legacyValue > 0 ? legacyValue : 0;
  saveBoardRevision(storage, boardId, revision);
  storage.removeItem(REVISION_KEY);
  return revision;
}
