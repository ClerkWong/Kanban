import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeSession } from "../app/projects/session";
import type { SyncConfig } from "../app/sync/config";
import { prepareInitialConnection } from "../app/sync/initial-connection";

const config: SyncConfig = {
  baseUrl: "https://sync.example",
  token: "personal-token-value",
};

function session(tokenKind: "personal" | "legacy"): RuntimeSession {
  return {
    user: {
      id: "10000000-0000-4000-8000-000000000001",
      displayName: "Staging Owner",
      tokenKind,
    },
    workspaces: [{
      workspaceId: "10000000-0000-4000-8000-000000000002",
      role: "owner",
    }],
  };
}

test("personal token persists config and enters Projects without calling legacy /board", async () => {
  const calls: string[] = [];
  const result = await prepareInitialConnection(config, {
    isCurrent: () => true,
    fetchSession: async () => {
      calls.push("session");
      return session("personal");
    },
    fetchLegacyBoard: async () => {
      calls.push("legacy-board");
      throw new Error("personal onboarding must not call legacy /board");
    },
    persistConfig: () => {
      calls.push("persist");
    },
  });

  assert.equal(result.kind, "projects");
  assert.deepEqual(calls, ["session", "persist"]);
});

test("legacy token retains the single-board bootstrap path", async () => {
  const calls: string[] = [];
  const remote = {
    revision: 3,
    board: { version: 4, columns: [], cards: {} },
  };
  const result = await prepareInitialConnection(config, {
    isCurrent: () => true,
    fetchSession: async () => {
      calls.push("session");
      return session("legacy");
    },
    fetchLegacyBoard: async () => {
      calls.push("legacy-board");
      return remote;
    },
    persistConfig: () => {
      calls.push("persist");
    },
  });

  assert.deepEqual(result, {
    kind: "legacy",
    session: session("legacy"),
    remote,
  });
  assert.deepEqual(calls, ["session", "persist", "legacy-board"]);
});

test("stale session never persists config or starts either client", async () => {
  const calls: string[] = [];
  const result = await prepareInitialConnection(config, {
    isCurrent: () => false,
    fetchSession: async () => session("personal"),
    fetchLegacyBoard: async () => {
      calls.push("legacy-board");
      return null;
    },
    persistConfig: () => {
      calls.push("persist");
    },
  });

  assert.deepEqual(result, { kind: "stale" });
  assert.deepEqual(calls, []);
});
