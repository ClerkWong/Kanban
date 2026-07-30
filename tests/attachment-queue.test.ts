import assert from "node:assert/strict";
import test from "node:test";

import type { AttachmentRef } from "../app/board-model";
import type { PlatformCapabilities } from "../app/platform/types";
import { ATTACHMENT_QUEUE_KEY_V2 } from "../app/projects/storage";
import {
  enqueueDelete,
  enqueueUpload,
  hasLegacyQueueBlocker,
  loadQueue,
  pendingUploads,
  processQueue,
  resumeBlockedQueue,
  retryDelay,
  saveQueue,
  type AttachmentQueueScope,
} from "../app/sync/attachment-queue";

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

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectA = "10000000-0000-4000-8000-000000000002";
const projectB = "10000000-0000-4000-8000-000000000003";
const boardA = "10000000-0000-4000-8000-000000000004";
const boardB = "10000000-0000-4000-8000-000000000005";
const userA = "10000000-0000-4000-8000-000000000006";
const userB = "10000000-0000-4000-8000-000000000007";

const scopeA: AttachmentQueueScope = {
  config: { baseUrl: "https://one.example/", token: "secret-one" },
  userId: userA,
  context: { workspaceId, projectId: projectA, boardId: boardA },
};
const scopeB: AttachmentQueueScope = {
  config: { baseUrl: "https://one.example", token: "secret-two" },
  userId: userA,
  context: { workspaceId, projectId: projectA, boardId: boardB },
};

function attachment(id: string, fileName = `${id}.jpg`): AttachmentRef {
  return {
    id,
    type: "photo",
    fileName,
    mimeType: "image/jpeg",
    size: 1,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function installBrowser() {
  const localStorage = new MemoryStorage();
  Object.assign(globalThis, { window: { localStorage } });
  return localStorage;
}

function platform(exists = true): PlatformCapabilities {
  return {
    isNative: false,
    syncCredentials: {
      secure: false,
      load: async () => null,
      save: async () => {},
    },
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

test("queue v2 validates its shape, stores every scope id, and never persists tokens", () => {
  const storage = installBrowser();
  storage.setItem(ATTACHMENT_QUEUE_KEY_V2, JSON.stringify([{ operation: "upload" }]));
  assert.deepEqual(loadQueue(), []);

  const photo = attachment("att-a");
  enqueueUpload(scopeA, photo);
  enqueueUpload(scopeA, photo);
  assert.equal(loadQueue().length, 1);
  assert.deepEqual(loadQueue()[0], {
    endpoint: "https://one.example",
    userId: userA,
    workspaceId,
    projectId: projectA,
    boardId: boardA,
    attachmentId: "att-a",
    fileName: "att-a.jpg",
    mimeType: "image/jpeg",
    operation: "upload",
    retryCount: 0,
    nextRetryAt: 0,
  });
  assert.equal(storage.getItem(ATTACHMENT_QUEUE_KEY_V2)?.includes("secret-one"), false);

  enqueueDelete(scopeA, photo);
  assert.equal(loadQueue().length, 1);
  assert.equal(loadQueue()[0].operation, "delete");
});

test("Board A/B can hold and process pending uploads independently", async () => {
  installBrowser();
  enqueueUpload(scopeA, attachment("att-a"));
  enqueueUpload(scopeB, attachment("att-b"));
  const remoteUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
    remoteUrls.push(String(input));
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(pendingUploads(scopeB, ["att-b"]).length, 1);
    const [resultA, resultB] = await Promise.all([
      processQueue(scopeA, platform(), 1),
      processQueue(scopeB, platform(), 1),
    ]);
    assert.equal(resultA.processed, 1);
    assert.equal(resultB.processed, 1);
    assert.equal(loadQueue().length, 0);
    assert.deepEqual(remoteUrls.sort(), [
      `https://one.example/projects/${projectA}/boards/${boardA}/attachments/att-a`,
      `https://one.example/projects/${projectA}/boards/${boardB}/attachments/att-b`,
    ].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("endpoint, user, Project, and Board scopes never process one another's items", async () => {
  installBrowser();
  const variants: AttachmentQueueScope[] = [
    { ...scopeA, config: { baseUrl: "https://two.example", token: "endpoint" } },
    { ...scopeA, userId: userB, config: { ...scopeA.config, token: "user" } },
    {
      ...scopeA,
      context: { ...scopeA.context, projectId: projectB },
      config: { ...scopeA.config, token: "project" },
    },
    scopeB,
  ];
  variants.forEach((scope, index) =>
    enqueueUpload(scope, attachment(`att-variant-${index}`))
  );
  let remoteCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
    remoteCalls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal((await processQueue(scopeA, platform(), 1)).processed, 0);
    assert.equal(remoteCalls, 0);
    assert.equal(loadQueue().length, variants.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("temporary upload errors retain only that Board item with exponential backoff", async () => {
  installBrowser();
  enqueueUpload(scopeA, attachment("att-retry"));
  enqueueUpload(scopeB, attachment("att-other"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
    throw new TypeError("network down");
  };
  try {
    const result = await processQueue(scopeA, platform(), 10_000);
    assert.equal(result.failure?.kind, "temporary");
    const retry = loadQueue().find((item) => item.attachmentId === "att-retry");
    const other = loadQueue().find((item) => item.attachmentId === "att-other");
    assert.equal(retry?.nextRetryAt, 10_000 + retryDelay(1));
    assert.equal(other?.nextRetryAt, 0);
    assert.equal(retryDelay(99), 60_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("413, archive, 403, and 404 remain durable blockers without automatic retries", async () => {
  for (const scenario of [
    { status: 413, body: {}, kind: "too-large", terminal: "too-large" },
    {
      status: 409,
      body: { error: "resource_archived" },
      kind: "archived",
      terminal: "remote-blocked",
    },
    { status: 403, body: { error: "forbidden" }, kind: "forbidden", terminal: "remote-blocked" },
    { status: 404, body: { error: "not_found" }, kind: "not-found", terminal: "remote-blocked" },
  ] as const) {
    installBrowser();
    enqueueUpload(scopeA, attachment("att-blocked"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      if (String(input).startsWith("data:")) return new Response(new Blob(["a"]));
      return new Response(JSON.stringify(scenario.body), {
        status: scenario.status,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      const result = await processQueue(scopeA, platform(), 10_000);
      assert.equal(result.failure?.kind, scenario.kind);
      assert.equal(loadQueue()[0].terminal, scenario.terminal);
      assert.equal(loadQueue()[0].nextRetryAt, 0);
      assert.equal((await processQueue(scopeA, platform(), 99_000)).processed, 0);
    } finally {
      globalThis.fetch = originalFetch;
      saveQueue([]);
    }
  }
});

test("manual resume only releases remote blockers, not too-large items", () => {
  installBrowser();
  const archived = attachment("att-archived");
  const tooLarge = attachment("att-large");
  enqueueUpload(scopeA, archived);
  enqueueUpload(scopeA, tooLarge);
  const queue = loadQueue();
  queue[0].terminal = "remote-blocked";
  queue[1].terminal = "too-large";
  saveQueue(queue);
  resumeBlockedQueue(scopeA);
  assert.equal(loadQueue()[0].terminal, undefined);
  assert.equal(loadQueue()[1].terminal, "too-large");
});

test("a referenced attachment delete waits until Board content no longer refers to its id", async () => {
  installBrowser();
  enqueueDelete(scopeA, attachment("att-referenced"));
  let remoteCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    remoteCalls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    await processQueue(
      scopeA,
      platform(),
      1,
      ["delete"],
      new Set(["att-referenced"]),
    );
    assert.equal(remoteCalls, 0);
    assert.equal(loadQueue().length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("any non-empty or malformed v1 queue is a migration blocker and is never guessed", async () => {
  const storage = installBrowser();
  storage.setItem("kanban-attachment-queue-v1", JSON.stringify([{
    endpoint: "https://one.example",
    type: "upload",
    fileName: "legacy.jpg",
    mimeType: "image/jpeg",
    retryCount: 0,
    nextRetryAt: 0,
  }]));
  enqueueUpload(scopeA, attachment("att-safe"));
  let remoteCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    remoteCalls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(hasLegacyQueueBlocker(), true);
    const result = await processQueue(scopeA, platform(), 1);
    assert.equal(result.failure?.kind, "migration-blocker");
    assert.equal(result.nextRetryAt, null);
    assert.equal(remoteCalls, 0);
    assert.equal(loadQueue().length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  storage.setItem("kanban-attachment-queue-v1", "{broken");
  assert.equal(hasLegacyQueueBlocker(), true);
  storage.setItem("kanban-attachment-queue-v1", JSON.stringify([{ type: "upload" }]));
  assert.equal(hasLegacyQueueBlocker(), true);
});
