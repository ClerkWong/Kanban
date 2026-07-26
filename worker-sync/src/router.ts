import type { AuthenticatedUser } from "./auth";
import { json, responseHeaders } from "./http";
import { decideBoardPut, isBoardPayload } from "./logic";

const MAX_BOARD_BYTES = 1_000_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_FILE_NAME_LENGTH = 128;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "audio/webm", "audio/mp4", "audio/aac", "audio/mpeg", "audio/wav", "audio/ogg",
]);

type RouteContext = {
  request: Request;
  env: Env;
  user: AuthenticatedUser;
  requestId: string;
};
type BoardRow = { revision: number; data: string };

async function readBoard(env: Env): Promise<BoardRow | null> {
  return env.DB.prepare("SELECT revision, data FROM board WHERE id = 1").first<BoardRow>();
}

function attachmentKey(pathname: string): string | null {
  if (!pathname.startsWith("/attachments/")) return null;
  const fileName = pathname.slice("/attachments/".length);
  return fileName.length > 0 &&
    fileName.length <= MAX_ATTACHMENT_FILE_NAME_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)
    ? `attachments/${fileName}`
    : null;
}

function allowedContentType(request: Request): string | null {
  const raw = request.headers.get("Content-Type");
  if (!raw) return null;
  const value = raw.split(";", 1)[0].trim().toLowerCase();
  return ALLOWED_ATTACHMENT_TYPES.has(value) ? value : null;
}

async function readBoundedBody(request: Request): Promise<Uint8Array | "empty" | "too_large"> {
  if (!request.body) return "empty";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
  if (!total) return "empty";
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function handleBoard(context: RouteContext): Promise<Response | null> {
  const { request, env, requestId } = context;
  if (new URL(request.url).pathname !== "/board") return null;
  if (request.method === "GET") {
    const row = await readBoard(env);
    return row
      ? json(200, { revision: row.revision, board: JSON.parse(row.data), requestId }, requestId)
      : json(404, { error: "empty", requestId }, requestId);
  }
  if (request.method !== "PUT") return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BOARD_BYTES) {
    return json(413, { error: "board too large", requestId }, requestId);
  }
  let payload: { baseRevision?: unknown; board?: unknown };
  try { payload = JSON.parse(text); } catch {
    return json(400, { error: "invalid json", requestId }, requestId);
  }
  const baseRevision = Number(payload.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision < 0 || !isBoardPayload(payload.board)) {
    return json(400, { error: "invalid payload", requestId }, requestId);
  }
  const row = await readBoard(env);
  const decision = decideBoardPut(row?.revision ?? null, baseRevision);
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
      ).bind(data, now).run();
      return json(200, { revision: 1, requestId }, requestId);
    } catch (error) {
      const fresh = await readBoard(env);
      if (fresh) return json(409, { revision: fresh.revision, board: JSON.parse(fresh.data), requestId }, requestId);
      throw error;
    }
  }
  const result = await env.DB.prepare(
    "UPDATE board SET revision = ?, data = ?, updated_at = ? WHERE id = 1 AND revision = ?",
  ).bind(decision.nextRevision, data, now, baseRevision).run();
  if (!result.meta.changes) {
    const fresh = await readBoard(env);
    return fresh
      ? json(409, { revision: fresh.revision, board: JSON.parse(fresh.data), requestId }, requestId)
      : json(409, { revision: 0, board: null, requestId }, requestId);
  }
  return json(200, { revision: decision.nextRevision, requestId }, requestId);
}

async function handleAttachment(context: RouteContext): Promise<Response | null> {
  const { request, env, requestId } = context;
  const key = attachmentKey(new URL(request.url).pathname);
  if (!new URL(request.url).pathname.startsWith("/attachments/")) return null;
  if (!key) return json(400, { error: "invalid attachment key", requestId }, requestId);
  if (request.method === "GET") {
    const object = await env.ATTACHMENTS.get(key);
    if (!object) return json(404, { error: "not found", requestId }, requestId);
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
    const length = request.headers.get("Content-Length");
    if (length && /^\d+$/.test(length) && Number(length) > MAX_ATTACHMENT_BYTES) {
      return json(413, { error: "attachment too large", requestId }, requestId);
    }
    const contentType = allowedContentType(request);
    if (!contentType) return json(415, { error: "unsupported attachment type", requestId }, requestId);
    const body = await readBoundedBody(request);
    if (body === "empty") return json(400, { error: "empty attachment", requestId }, requestId);
    if (body === "too_large") return json(413, { error: "attachment too large", requestId }, requestId);
    await env.ATTACHMENTS.put(key, body, { httpMetadata: { contentType } });
    return json(200, { ok: true, requestId }, requestId);
  }
  if (request.method === "DELETE") {
    await env.ATTACHMENTS.delete(key);
    return json(200, { ok: true, requestId }, requestId);
  }
  return null;
}

type Route = {
  capability: "authenticated";
  handle(context: RouteContext): Promise<Response | null>;
};
const ROUTES: readonly Route[] = [
  { capability: "authenticated", handle: handleBoard },
  { capability: "authenticated", handle: handleAttachment },
];

export async function routeRequest(context: RouteContext): Promise<Response> {
  for (const route of ROUTES) {
    const response = await route.handle(context);
    if (response) return response;
  }
  return json(404, { error: "not found", requestId: context.requestId }, context.requestId);
}
