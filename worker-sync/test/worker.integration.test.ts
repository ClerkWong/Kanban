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
const maxAttachmentBytes = 10 * 1024 * 1024;

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
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM board").run();
  await env.DB.prepare("DELETE FROM users").run();
  await env.DB.prepare("INSERT INTO users (id, name, token_hash) VALUES (?, ?, ?)")
    .bind("runtime-test-user", "Runtime test", tokenHash)
    .run();
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

  it("uploads, returns metadata for, deletes, and then misses an attachment", async () => {
    const content = new Uint8Array([1, 2, 3, 4]);
    const put = await dispatch("/attachments/runtime-test.jpeg", {
      method: "PUT",
      headers: authorizationHeaders({ "Content-Type": "image/jpeg" }),
      body: content,
    });
    expect(put.status).toBe(200);

    const get = await dispatch("/attachments/runtime-test.jpeg", { headers: authorizationHeaders() });
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/jpeg");
    expect(get.headers.get("Content-Length")).toBe(String(content.byteLength));
    expect(get.headers.get("ETag")).toBeTruthy();
    expect(get.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(get.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(content);

    expect(
      (
        await dispatch("/attachments/runtime-test.jpeg", {
          method: "DELETE",
          headers: authorizationHeaders(),
        })
      ).status,
    ).toBe(200);
    expect((await dispatch("/attachments/runtime-test.jpeg", { headers: authorizationHeaders() })).status).toBe(404);
  });

  it("rejects invalid keys, MIME types, and empty uploads", async () => {
    expect(
      (
        await dispatch("/attachments/%2F", {
          method: "PUT",
          headers: authorizationHeaders({ "Content-Type": "image/jpeg" }),
          body: new Uint8Array([1]),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await dispatch("/attachments/nope.txt", {
          method: "PUT",
          headers: authorizationHeaders({ "Content-Type": "text/plain" }),
          body: "x",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await dispatch("/attachments/empty.jpeg", {
          method: "PUT",
          headers: authorizationHeaders({ "Content-Type": "image/jpeg" }),
          body: "",
        })
      ).status,
    ).toBe(400);
  });

  it("rejects declared and streamed uploads above 10 MiB", async () => {
    const declaredTooLarge = await dispatch("/attachments/declared.jpeg", {
      method: "PUT",
      headers: authorizationHeaders({
        "Content-Type": "image/jpeg",
        "Content-Length": String(maxAttachmentBytes + 1),
      }),
      body: new Uint8Array([1]),
    });
    expect(declaredTooLarge.status).toBe(413);

    const streamedTooLarge = await dispatch("/attachments/streamed.jpeg", {
      method: "PUT",
      headers: authorizationHeaders({ "Content-Type": "image/jpeg" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(maxAttachmentBytes + 1));
          controller.close();
        },
      }),
    });
    expect(streamedTooLarge.status).toBe(413);
  });

  it("turns D1 and R2 failures into the same JSON, CORS, request-id error envelope", async () => {
    vi.spyOn(env.DB, "prepare").mockImplementationOnce(() => {
      throw new Error("D1 is unavailable");
    });
    const d1Failure = await dispatch("/board", { headers: authorizationHeaders() });
    expect(d1Failure.status).toBe(500);
    expect(await d1Failure.json()).toMatchObject({ error: "internal error" });
    expect(d1Failure.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(d1Failure.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    vi.spyOn(env.ATTACHMENTS, "get").mockRejectedValueOnce(new Error("R2 is unavailable"));
    const r2Failure = await dispatch("/attachments/error.jpeg", { headers: authorizationHeaders() });
    expect(r2Failure.status).toBe(500);
    expect(await r2Failure.json()).toMatchObject({ error: "internal error" });
    expect(r2Failure.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r2Failure.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
