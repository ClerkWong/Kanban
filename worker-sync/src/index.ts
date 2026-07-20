import type { D1Database } from "./d1";
import { decideBoardPut, isBoardPayload, sha256Hex } from "./logic";

interface Env {
  DB: D1Database;
}

const MAX_BOARD_BYTES = 1_000_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function authenticate(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return false;
  }
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT id FROM users WHERE token_hash = ?").bind(hash).first();
  return row !== null;
}

type BoardRow = { revision: number; data: string };

async function readBoard(env: Env): Promise<BoardRow | null> {
  return env.DB.prepare("SELECT revision, data FROM board WHERE id = 1").first<BoardRow>();
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!(await authenticate(request, env))) {
      return json(401, { error: "unauthorized" });
    }

    const url = new URL(request.url);

    if (url.pathname === "/board" && request.method === "GET") {
      const row = await readBoard(env);
      if (!row) {
        return json(404, { error: "empty" });
      }
      return json(200, { revision: row.revision, board: JSON.parse(row.data) });
    }

    if (url.pathname === "/board" && request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_BOARD_BYTES) {
        return json(413, { error: "board too large" });
      }
      let payload: { baseRevision?: unknown; board?: unknown };
      try {
        payload = JSON.parse(text);
      } catch {
        return json(400, { error: "invalid json" });
      }
      const baseRevision = Number(payload.baseRevision);
      if (!Number.isInteger(baseRevision) || baseRevision < 0 || !isBoardPayload(payload.board)) {
        return json(400, { error: "invalid payload" });
      }

      const row = await readBoard(env);
      const decision = decideBoardPut(row ? row.revision : null, baseRevision);
      if (decision.kind === "conflict") {
        return row
          ? json(409, { revision: row.revision, board: JSON.parse(row.data) })
          : json(409, { revision: 0, board: null });
      }

      const now = new Date().toISOString();
      const data = JSON.stringify(payload.board);
      if (decision.kind === "create") {
        await env.DB.prepare(
          "INSERT INTO board (id, revision, data, updated_at) VALUES (1, 1, ?, ?)",
        )
          .bind(data, now)
          .run();
        return json(200, { revision: 1 });
      }

      const result = await env.DB.prepare(
        "UPDATE board SET revision = ?, data = ?, updated_at = ? WHERE id = 1 AND revision = ?",
      )
        .bind(decision.nextRevision, data, now, baseRevision)
        .run();
      if (!result.meta.changes) {
        const fresh = await readBoard(env);
        return fresh
          ? json(409, { revision: fresh.revision, board: JSON.parse(fresh.data) })
          : json(409, { revision: 0, board: null });
      }
      return json(200, { revision: decision.nextRevision });
    }

    return json(404, { error: "not found" });
  },
};

export default worker;
