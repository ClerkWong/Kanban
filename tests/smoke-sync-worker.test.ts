import assert from "node:assert/strict";
import test from "node:test";

import { runSmoke } from "../scripts/smoke-sync-worker.mjs";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function json(body: unknown, status = 200, responseHeaders: HeadersInit = headers): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

test("multi-project smoke accepts a fresh workspace without Projects", async () => {
  const paths: string[] = [];
  const result = await runSmoke({
    workerUrl: "https://sync.example",
    token: "personal-test-token-value-that-is-long-enough",
    log: () => undefined,
    fetchImpl: async (input, init) => {
      const url = new URL(input.toString());
      paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      if (url.pathname === "/me") {
        return json({
          user: { id: "user-a", tokenKind: "personal" },
          workspaces: [{ workspaceId: "workspace-a", role: "owner" }],
        });
      }
      return json({ projects: [] });
    },
  });

  assert.deepEqual(result, {
    userId: "user-a",
    workspaceCount: 1,
    projectCount: 0,
    sampledBoards: 0,
  });
  assert.deepEqual(paths, ["OPTIONS /me", "GET /me", "GET /projects"]);
});

test("multi-project smoke samples the first available Board", async () => {
  const result = await runSmoke({
    workerUrl: "https://sync.example/",
    token: "personal-test-token-value-that-is-long-enough",
    log: () => undefined,
    fetchImpl: async (input, init) => {
      const url = new URL(input.toString());
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      if (url.pathname === "/me") {
        return json({
          user: { id: "user-a", tokenKind: "personal" },
          workspaces: [],
        });
      }
      if (url.pathname === "/projects") {
        return json({ projects: [{ id: "project-a" }] });
      }
      if (url.pathname.endsWith("/boards")) {
        assert.equal(url.searchParams.get("status"), "active");
        return json({ boards: [{ id: "board-a" }] });
      }
      return json({
        board: {
          content: { revision: 0, board: { version: 4, columns: [], cards: {} } },
        },
      });
    },
  });

  assert.equal(result.sampledBoards, 1);
});

test("multi-project smoke rejects legacy tokens and missing CORS", async () => {
  await assert.rejects(
    runSmoke({
      workerUrl: "https://sync.example",
      token: "legacy-test-token-value-that-is-long-enough",
      log: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
        return json({
          user: { id: "user-a", tokenKind: "legacy" },
          workspaces: [],
        });
      },
    }),
    /personal token contract/,
  );

  await assert.rejects(
    runSmoke({
      workerUrl: "https://sync.example",
      token: "personal-test-token-value-that-is-long-enough",
      log: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
        return json(
          {
            user: { id: "user-a", tokenKind: "personal" },
            workspaces: [],
          },
          200,
          { "Content-Type": "application/json" },
        );
      },
    }),
    /Access-Control-Allow-Origin/,
  );
});
