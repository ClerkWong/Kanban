import assert from "node:assert/strict";
import test from "node:test";

import type { SyncCredentialStorage } from "../app/platform/types";
import { SYNC_CONFIG_KEY_V2 } from "../app/projects/storage";
import { loadSyncConfig, saveSyncConfig } from "../app/sync/config";

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class SecureMemoryStorage implements SyncCredentialStorage {
  secure = true;
  value: string | null = null;
  failSave = false;

  async load(): Promise<string | null> {
    return this.value;
  }

  async save(value: string | null): Promise<void> {
    if (this.failSave) {
      throw new Error("secure storage unavailable");
    }
    this.value = value;
  }
}

async function withWindowStorage(
  run: (storage: MemoryStorage) => Promise<void>,
): Promise<void> {
  const storage = new MemoryStorage();
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  try {
    await run(storage);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("native startup migrates a WebView token only after secure storage succeeds", async () => {
  await withWindowStorage(async (browser) => {
    browser.setItem(SYNC_CONFIG_KEY_V2, JSON.stringify({
      baseUrl: "https://sync.example/",
      token: "native-token",
    }));
    const secure = new SecureMemoryStorage();

    assert.deepEqual(await loadSyncConfig(secure), {
      baseUrl: "https://sync.example",
      token: "native-token",
    });
    assert.deepEqual(JSON.parse(secure.value ?? "null"), {
      baseUrl: "https://sync.example",
      token: "native-token",
    });
    assert.equal(browser.getItem(SYNC_CONFIG_KEY_V2), null);
  });
});

test("failed native migration retains the WebView token and does not use it", async () => {
  await withWindowStorage(async (browser) => {
    const raw = JSON.stringify({
      baseUrl: "https://sync.example",
      token: "keep-until-migrated",
    });
    browser.setItem(SYNC_CONFIG_KEY_V2, raw);
    const secure = new SecureMemoryStorage();
    secure.failSave = true;

    assert.equal(await loadSyncConfig(secure), null);
    assert.equal(browser.getItem(SYNC_CONFIG_KEY_V2), raw);
  });
});

test("native save and clear never leave token JSON in WebView localStorage", async () => {
  await withWindowStorage(async (browser) => {
    browser.setItem("kanban-sync-config-v1", "stale");
    browser.setItem(SYNC_CONFIG_KEY_V2, "stale");
    const secure = new SecureMemoryStorage();

    await saveSyncConfig({
      baseUrl: "https://sync.example/",
      token: "secure-token",
    }, secure);
    assert.equal(browser.getItem("kanban-sync-config-v1"), null);
    assert.equal(browser.getItem(SYNC_CONFIG_KEY_V2), null);
    assert.match(secure.value ?? "", /secure-token/);

    await saveSyncConfig(null, secure);
    assert.equal(secure.value, null);
  });
});
