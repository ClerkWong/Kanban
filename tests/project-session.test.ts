import assert from "node:assert/strict";
import test from "node:test";

import { ProjectRepository } from "../app/projects/repository";
import { parseRuntimeSession, type RuntimeSession } from "../app/projects/session";
import { SYNC_CONFIG_KEY_V2 } from "../app/projects/storage";
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from "../app/sync/config";

const workspaceId = "b0000000-0000-4000-8000-000000000001";
const projectId = "b0000000-0000-4000-8000-000000000002";
const boardId = "b0000000-0000-4000-8000-000000000003";
const userA = "b0000000-0000-4000-8000-000000000004";
const userB = "b0000000-0000-4000-8000-000000000005";
const configA = { baseUrl: "https://sync.example", token: "token-a" };
const configB = { baseUrl: "https://sync.example", token: "token-b" };

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

function session(userId: string, displayName: string): RuntimeSession {
  return {
    user: { id: userId, displayName, tokenKind: "personal" },
    workspaces: [{ workspaceId, role: "member" }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withWindowStorage(
  run: (storage: MemoryStorage) => void | Promise<void>,
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

test("runtime session accepts only server identity and known workspace roles", () => {
  assert.deepEqual(parseRuntimeSession({
    user: { id: userA, displayName: "Alice", role: "owner", tokenKind: "legacy" },
    workspaces: [{ workspaceId, role: "admin", userId: userB }],
    localUserId: userB,
  }), {
    user: { id: userA, displayName: "Alice", tokenKind: "legacy" },
    workspaces: [{ workspaceId, role: "admin" }],
  });
  assert.equal(parseRuntimeSession({
    user: { id: "local-user", displayName: "Bad", tokenKind: "personal" },
    workspaces: [],
  }), null);
  assert.equal(parseRuntimeSession({
    user: { id: userA, displayName: "Alice", tokenKind: "personal" },
    workspaces: [{ workspaceId, role: "manager" }],
  }), null);
});

test("SyncConfig v2 persists only base URL/token and migrates v1 without identity overrides", async () => {
  await withWindowStorage((storage) => {
    storage.setItem("kanban-sync-config-v1", JSON.stringify({
      baseUrl: "https://sync.example/",
      token: "legacy-token",
      userId: userB,
      workspaceRole: "owner",
    }));
    assert.deepEqual(loadSyncConfig(), {
      baseUrl: "https://sync.example",
      token: "legacy-token",
    });
    assert.equal(storage.getItem("kanban-sync-config-v1"), null);
    assert.deepEqual(JSON.parse(storage.getItem(SYNC_CONFIG_KEY_V2) ?? "null"), {
      baseUrl: "https://sync.example",
      token: "legacy-token",
    });

    saveSyncConfig({
      baseUrl: "https://next.example/",
      token: "next-token",
      userId: userA,
      workspaceRole: "admin",
    } as SyncConfig & { userId: string; workspaceRole: string });
    assert.deepEqual(JSON.parse(storage.getItem(SYNC_CONFIG_KEY_V2) ?? "null"), {
      baseUrl: "https://next.example",
      token: "next-token",
    });
  });
});

test("token switching clears runtime session and remote index without touching local Board data", async () => {
  await withWindowStorage(async (storage) => {
    storage.setItem(`kanban-board-v1:${boardId}`, "local-board-sentinel");
    const nextSession = deferred<RuntimeSession>();
    const repository = new ProjectRepository(async (config) =>
      config.token === "token-a" ? session(userA, "Alice") : nextSession.promise
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/boards")) {
        return new Response(JSON.stringify({
          boards: [{
            id: boardId,
            projectId,
            name: "Roadmap",
            status: "active",
            revision: 0,
            createdBy: userA,
            createdAt: "2026-07-27T00:00:00.000Z",
            updatedAt: "2026-07-27T00:00:00.000Z",
            archivedAt: null,
            archivedBy: null,
          }],
        }));
      }
      return new Response(JSON.stringify({
        projects: [{
          id: projectId,
          name: "Alpha",
          status: "active",
          myRole: "manager",
          activeBoardCount: 1,
          lastActivityAt: null,
        }],
      }));
    };
    try {
      assert.equal((await repository.connect(configA))?.user.id, userA);
      await repository.refreshProjects();
      await repository.refreshBoards(projectId);
      assert.equal(repository.getRemoteIndex().projects.length, 1);
      assert.equal(repository.getRemoteIndex().boardsByProject[projectId].length, 1);

      const switching = repository.connect(configB);
      assert.equal(repository.getSession(), null);
      assert.deepEqual(repository.getRemoteIndex(), { projects: [], boardsByProject: {} });
      nextSession.resolve(session(userB, "Bob"));
      assert.equal((await switching)?.user.id, userB);
      assert.equal(storage.getItem(`kanban-board-v1:${boardId}`), "local-board-sentinel");

      repository.disconnect();
      assert.equal(repository.getSession(), null);
      assert.deepEqual(repository.getRemoteIndex(), { projects: [], boardsByProject: {} });
      assert.equal(storage.getItem(`kanban-board-v1:${boardId}`), "local-board-sentinel");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a late session response cannot replace the newer token session", async () => {
  const a = deferred<RuntimeSession>();
  const b = deferred<RuntimeSession>();
  const repository = new ProjectRepository((config) =>
    config.token === "token-a" ? a.promise : b.promise
  );
  const first = repository.connect(configA);
  const second = repository.connect(configB);

  b.resolve(session(userB, "Bob"));
  assert.equal((await second)?.user.id, userB);
  a.resolve(session(userA, "Alice"));
  assert.equal(await first, null);
  assert.equal(repository.getSession()?.user.id, userB);
});
