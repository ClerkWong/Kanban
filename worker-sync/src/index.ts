import { decideBoardPut, isBoardPayload, sha256Hex } from "./logic";

const MAX_BOARD_BYTES = 1_000_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB
const MAX_ATTACHMENT_FILE_NAME_LENGTH = 128;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, ETag, X-Request-Id",
  "Access-Control-Max-Age": "86400",
};

function responseHeaders(requestId: string, init?: HeadersInit): Headers {
  const headers = new Headers(CORS_HEADERS);
  headers.set("X-Request-Id", requestId);
  if (init) {
    for (const [name, value] of new Headers(init)) {
      headers.set(name, value);
    }
  }
  return headers;
}

function json(status: number, body: Record<string, unknown>, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(requestId, { "Content-Type": "application/json" }),
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

function attachmentKey(pathname: string): string | null {
  const prefix = "/attachments/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const fileName = pathname.slice(prefix.length);
  if (
    fileName.length === 0 ||
    fileName.length > MAX_ATTACHMENT_FILE_NAME_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)
  ) {
    return null;
  }

  return `attachments/${fileName}`;
}

function allowedContentType(request: Request): string | null {
  const raw = request.headers.get("Content-Type");
  if (!raw) {
    return null;
  }
  const contentType = raw.split(";", 1)[0].trim().toLowerCase();
  return ALLOWED_ATTACHMENT_TYPES.has(contentType) ? contentType : null;
}

async function readBoundedBody(request: Request): Promise<Uint8Array | "empty" | "too_large"> {
  if (!request.body) {
    return "empty";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    return "empty";
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function logRequestError(request: Request, requestId: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event: "request_error",
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(requestId) });
    }

    try {
      if (!(await authenticate(request, env))) {
        return json(401, { error: "unauthorized", requestId }, requestId);
      }

      const url = new URL(request.url);

      if (url.pathname === "/board" && request.method === "GET") {
        const row = await readBoard(env);
        if (!row) {
          return json(404, { error: "empty", requestId }, requestId);
        }
        return json(200, { revision: row.revision, board: JSON.parse(row.data), requestId }, requestId);
      }

      if (url.pathname === "/board" && request.method === "PUT") {
        const text = await request.text();
        const byteLength = new TextEncoder().encode(text).length;
        if (byteLength > MAX_BOARD_BYTES) {
          return json(413, { error: "board too large", requestId }, requestId);
        }
        let payload: { baseRevision?: unknown; board?: unknown };
        try {
          payload = JSON.parse(text);
        } catch {
          return json(400, { error: "invalid json", requestId }, requestId);
        }
        const baseRevision = Number(payload.baseRevision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0 || !isBoardPayload(payload.board)) {
          return json(400, { error: "invalid payload", requestId }, requestId);
        }

        const row = await readBoard(env);
        const decision = decideBoardPut(row ? row.revision : null, baseRevision);
        if (decision.kind === "conflict") {
          return row
            ? json(409, { revision: row.revision, board: JSON.parse(row.data), requestId }, requestId)
            : json(409, { revision: 0, board: null, requestId }, requestId);
        }

        const now = new Date().toISOString();
        const data = JSON.stringify(payload.board);
        if (decision.kind === "create") {
          try {
            await env.DB.prepare(
              "INSERT INTO board (id, revision, data, updated_at) VALUES (1, 1, ?, ?)",
            )
              .bind(data, now)
              .run();
            return json(200, { revision: 1, requestId }, requestId);
          } catch (error) {
            const fresh = await readBoard(env);
            if (fresh) {
              return json(409, { revision: fresh.revision, board: JSON.parse(fresh.data), requestId }, requestId);
            }
            throw error;
          }
        }

        const result = await env.DB.prepare(
          "UPDATE board SET revision = ?, data = ?, updated_at = ? WHERE id = 1 AND revision = ?",
        )
          .bind(decision.nextRevision, data, now, baseRevision)
          .run();
        if (!result.meta.changes) {
          const fresh = await readBoard(env);
          return fresh
            ? json(409, { revision: fresh.revision, board: JSON.parse(fresh.data), requestId }, requestId)
            : json(409, { revision: 0, board: null, requestId }, requestId);
        }
        return json(200, { revision: decision.nextRevision, requestId }, requestId);
      }

      if (url.pathname.startsWith("/attachments/")) {
        const key = attachmentKey(url.pathname);
        if (!key) {
          return json(400, { error: "invalid attachment key", requestId }, requestId);
        }

        if (request.method === "GET") {
          const object = await env.ATTACHMENTS.get(key);
          if (!object) {
            return json(404, { error: "not found", requestId }, requestId);
          }
          const headers = responseHeaders(requestId);
          object.writeHttpMetadata(headers);
          headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
          headers.set("Content-Length", object.size.toString());
          headers.set("ETag", object.httpEtag);
          headers.set("X-Content-Type-Options", "nosniff");
          headers.set("Cache-Control", "private, max-age=3600");
          return new Response(object.body, { headers });
        }

        if (request.method === "PUT") {
          const contentLength = request.headers.get("Content-Length");
          if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
            return json(413, { error: "attachment too large", requestId }, requestId);
          }
          const contentType = allowedContentType(request);
          if (!contentType) {
            return json(415, { error: "unsupported attachment type", requestId }, requestId);
          }
          const body = await readBoundedBody(request);
          if (body === "empty") {
            return json(400, { error: "empty attachment", requestId }, requestId);
          }
          if (body === "too_large") {
            return json(413, { error: "attachment too large", requestId }, requestId);
          }
          await env.ATTACHMENTS.put(key, body, { httpMetadata: { contentType } });
          return json(200, { ok: true, requestId }, requestId);
        }

        if (request.method === "DELETE") {
          await env.ATTACHMENTS.delete(key);
          return json(200, { ok: true, requestId }, requestId);
        }
      }

      return json(404, { error: "not found", requestId }, requestId);
    } catch (error) {
      logRequestError(request, requestId, error);
      return json(500, { error: "internal error", requestId }, requestId);
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
