import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueDelete,
  enqueueUpload,
  loadQueue,
  pendingUploads,
  processQueue,
  retryDelay,
  saveQueue,
} from "../app/sync/attachment-queue";
import type { SyncConfig } from "../app/sync/config";
import type { PlatformCapabilities } from "../app/platform/types";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const configA: SyncConfig = { baseUrl: "https://one.example/", token: "secret-one" };
const configB: SyncConfig = { baseUrl: "https://two.example", token: "two" };

function installBrowser() {
  const localStorage = new MemoryStorage();
  Object.assign(globalThis, { window: { localStorage } });
  return localStorage;
}

function platform(exists = true): PlatformCapabilities {
  return {
    isNative: false,
    takePhoto: async () => null,
    audio: { startRecording: async () => {}, stopRecording: async () => null },
    speech: { available: async () => false, start: async () => "", stop: async () => {} },
    attachments: {
      save: async () => ({ fileName: "unused", size: 0 }),
      exists: async () => exists,
      write: async () => {},
      loadAsUrl: async () => "data:application/octet-stream;base64,AA==",
      remove: async () => {},
    },
  };
}

test("附件佇列驗證資料形狀，並以端點去重且用 delete 取代待上傳項目", () => {
  const storage = installBrowser();
  storage.setItem("kanban-attachment-queue-v1", JSON.stringify([{ type: "upload", fileName: 3 }]));
  assert.deepEqual(loadQueue(), []);

  enqueueUpload(configA, "a.jpg", "image/jpeg");
  enqueueUpload({ ...configA, baseUrl: "https://one.example" }, "a.jpg", "image/jpeg");
  assert.equal(loadQueue().length, 1);
  assert.equal(storage.getItem("kanban-attachment-queue-v1")?.includes(configA.token), false);
  enqueueDelete(configA, "a.jpg");
  assert.equal(loadQueue().length, 1);
  assert.equal(loadQueue()[0].type, "delete");
  enqueueDelete(configA, "a.jpg");
  assert.equal(loadQueue().length, 1);
});

test("切換 endpoint 不會處理舊 endpoint 的附件佇列", async () => {
  installBrowser();
  enqueueUpload(configA, "a.jpg", "image/jpeg");
  let remoteCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
    remoteCalls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    const result = await processQueue(configB, platform(), 1);
    assert.equal(result.processed, 0);
    assert.equal(remoteCalls, 0);
    assert.equal(pendingUploads(configA, ["a.jpg"]).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("未知 upload 錯誤保留佇列並以可測指數退避重試", async () => {
  installBrowser();
  enqueueUpload(configA, "retry.jpg", "image/jpeg");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
    throw new TypeError("network down");
  };
  try {
    const result = await processQueue(configA, platform(), 10_000);
    assert.equal(result.failure?.kind, "temporary");
    assert.equal(loadQueue()[0].nextRetryAt, 10_000 + retryDelay(1));
    assert.equal(retryDelay(1), 2_000);
    assert.equal(retryDelay(99), 60_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("413 upload 保留為 terminal blocker，不能讓 reference 被後續同步放行", async () => {
  installBrowser();
  enqueueUpload(configA, "large.jpg", "image/jpeg");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
    return new Response(null, { status: 413 });
  };
  try {
    await processQueue(configA, platform(), 10_000);
    assert.equal(pendingUploads(configA, ["large.jpg"]).length, 1);
    assert.equal(loadQueue()[0].terminal, "too-large");
  } finally {
    globalThis.fetch = originalFetch;
    saveQueue([]);
  }
});

test("仍被看板引用的附件 delete 會停在 queue，等待 board push 後才可送出", async () => {
  installBrowser();
  enqueueDelete(configA, "still-referenced.jpg");
  let remoteCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    remoteCalls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    await processQueue(configA, platform(), 1, ["delete"], new Set(["still-referenced.jpg"]));
    assert.equal(remoteCalls, 0);
    assert.equal(loadQueue().length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    saveQueue([]);
  }
});
