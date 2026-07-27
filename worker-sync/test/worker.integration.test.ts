import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

declare module "cloudflare:workers" {
  // Cloudflare's test pool declaration-merges bindings through this marker interface.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const token = "worker-runtime-test-token";
const tokenHash = "3e8e0d7c0481d3805f19d9269f96965d4bc7848fa6d7e10291eb63115842ff87";
const endpoint = "https://sync.test";

function authorizationHeaders(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  result.set("Authorization", `Bearer ${token}`);
  return result;
}

async function dispatch(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`${endpoint}${path}`, init));
}

function board(version = 3): Record<string, unknown> {
  return { version, columns: [], cards: {} };
}

beforeAll(async () => {
  await env.DB
    .prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE)")
    .run();
  await env.DB
    .prepare("CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)")
    .run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS migration_state (
       id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT NOT NULL,
       legacy_project_id TEXT NOT NULL, legacy_board_id TEXT NOT NULL,
       locked_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, error TEXT
     )`,
  ).run();
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM board").run();
  await env.DB.prepare("DELETE FROM migration_state").run();
  await env.DB.prepare("DELETE FROM access_tokens").run();
  await env.DB.prepare("DELETE FROM user_accounts").run();
  await env.DB.prepare("DELETE FROM users").run();
  await env.DB.prepare("INSERT INTO users (id, name, token_hash) VALUES (?, ?, ?)")
    .bind("runtime-test-user", "Runtime test", tokenHash)
    .run();
  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  ).bind("runtime-test-user", "Runtime test", "2026-07-26T00:00:00.000Z", "2026-07-26T00:00:00.000Z").run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, ?, ?, 'personal', ?)",
  ).bind("runtime-test-token", "runtime-test-user", "Runtime", tokenHash, "2026-07-26T00:00:00.000Z").run();
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'pending', ?, ?, ?, ?)`,
  ).bind(
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
    "2026-07-26T00:00:00.000Z",
  ).run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Worker runtime integration", () => {
  it("returns CORS preflight without requiring authentication", async () => {
    const response = await dispatch("/board", { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects missing and incorrect tokens while accepting a valid token", async () => {
    expect((await dispatch("/board")).status).toBe(401);
    expect(
      (
        await dispatch("/board", {
          headers: { Authorization: "Bearer incorrect" },
        })
      ).status,
    ).toBe(401);
    expect((await dispatch("/board", { headers: authorizationHeaders() })).status).toBe(404);
  });

  it("creates a board and reports stale updates as a compatible 409 response", async () => {
    const created = await dispatch("/board", {
      method: "PUT",
      headers: authorizationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ baseRevision: 0, board: board() }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ revision: 1 });

    const conflict = await dispatch("/board", {
      method: "PUT",
      headers: authorizationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ baseRevision: 0, board: board(4) }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ revision: 1, board: board() });
  });

  it("converges concurrent initial creates to one success and one conflict", async () => {
    const makeCreate = () =>
      dispatch("/board", {
        method: "PUT",
        headers: authorizationHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ baseRevision: 0, board: board() }),
      });

    const responses = await Promise.all([makeCreate(), makeCreate()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it("keeps legacy reads available but returns a retryable error for PUT while migration is locked", async () => {
    await env.DB.prepare(
      "INSERT INTO board (id, revision, data, updated_at) VALUES (1, 4, ?, ?)",
    ).bind(JSON.stringify(board()), "2026-07-26T00:00:00.000Z").run();
    await env.DB.prepare(
      "UPDATE migration_state SET status = 'locked' WHERE id = 1",
    ).run();

    expect((await dispatch("/board", { headers: authorizationHeaders() })).status).toBe(200);
    const put = await dispatch("/board", {
      method: "PUT",
      headers: authorizationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ baseRevision: 4, board: board(4) }),
    });
    expect(put.status).toBe(503);
    expect(await put.json()).toMatchObject({ error: "migration_locked" });
    expect(
      await env.DB.prepare("SELECT revision FROM board WHERE id = 1").first<number>("revision"),
    ).toBe(4);
  });

  it("keeps the legacy file-name attachment route disabled", async () => {
    expect(
      (await dispatch("/attachments/runtime-test.jpeg", {
        headers: authorizationHeaders(),
      })).status,
    ).toBe(404);
  });

  it("turns D1 failures into the JSON, CORS, request-id error envelope", async () => {
    vi.spyOn(env.DB, "prepare").mockImplementationOnce(() => {
      throw new Error("D1 is unavailable");
    });
    const d1Failure = await dispatch("/board", { headers: authorizationHeaders() });
    expect(d1Failure.status).toBe(500);
    expect(await d1Failure.json()).toMatchObject({ error: "internal error" });
    expect(d1Failure.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(d1Failure.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
