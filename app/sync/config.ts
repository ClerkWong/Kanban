import {
  SYNC_CONFIG_KEY_V2,
  loadBoardRevision,
  saveBoardRevision,
  syncRevisionKey,
  type StorageLike,
} from "../projects/storage";
import type { SyncCredentialStorage } from "../platform/types";

export type SyncConfig = { baseUrl: string; token: string };

const LEGACY_CONFIG_KEY = "kanban-sync-config-v1";
const REVISION_KEY = "kanban-sync-revision-v1";

function browserStorage(): StorageLike {
  if (typeof window === "undefined") {
    throw new Error("同步設定只能在瀏覽器環境使用。");
  }
  return window.localStorage;
}

function loadBrowserRaw(storage: StorageLike): string | null {
  return (
    storage.getItem(SYNC_CONFIG_KEY_V2) ??
    storage.getItem(LEGACY_CONFIG_KEY)
  );
}

function clearBrowserCredentials(storage: StorageLike): void {
  storage.removeItem(SYNC_CONFIG_KEY_V2);
  storage.removeItem(LEGACY_CONFIG_KEY);
}

export const webSyncCredentialStorage: SyncCredentialStorage = {
  secure: false,
  async load() {
    return loadBrowserRaw(browserStorage());
  },
  async save(value) {
    const storage = browserStorage();
    if (value === null) {
      clearBrowserCredentials(storage);
      return;
    }
    storage.setItem(SYNC_CONFIG_KEY_V2, value);
    storage.removeItem(LEGACY_CONFIG_KEY);
  },
};

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

function parseSyncConfig(raw: string): SyncConfig | null {
  try {
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
    return { baseUrl: normalizeBaseUrl(parsed.baseUrl), token: parsed.token };
  } catch {
    return null;
  }
}

export async function loadSyncConfig(
  target: SyncCredentialStorage = webSyncCredentialStorage,
): Promise<SyncConfig | null> {
  try {
    const storedRaw = await target.load();
    const migrationStorage = target.secure ? browserStorage() : null;
    const raw = storedRaw ?? (
      migrationStorage ? loadBrowserRaw(migrationStorage) : null
    );
    if (!raw) {
      return null;
    }
    const config = parseSyncConfig(raw);
    if (!config) {
      return null;
    }
    const normalized = JSON.stringify(config);
    if (target.secure) {
      if (storedRaw === null) {
        // Delete the WebView token only after the secure native write succeeds.
        await target.save(normalized);
      }
      clearBrowserCredentials(migrationStorage!);
    } else if (storedRaw !== normalized || browserStorage().getItem(LEGACY_CONFIG_KEY)) {
      await target.save(normalized);
    }
    return config;
  } catch {
    // A failed native migration deliberately leaves the old localStorage value
    // untouched so a transient Keychain/Keystore error cannot lose credentials.
    return null;
  }
}

export async function saveSyncConfig(
  config: SyncConfig | null,
  target: SyncCredentialStorage = webSyncCredentialStorage,
): Promise<void> {
  if (config) {
    await target.save(JSON.stringify({
      baseUrl: normalizeBaseUrl(config.baseUrl),
      token: config.token,
    }));
    if (target.secure) {
      clearBrowserCredentials(browserStorage());
    }
  } else {
    await target.save(null);
    const storage = browserStorage();
    clearBrowserCredentials(storage);
    storage.removeItem(REVISION_KEY);
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
