import { authorizeProject } from "./authorization";
import type { ResourceStatus } from "./db-types";
import { json, responseHeaders } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_ID_LENGTH = 128;
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "audio/webm", "audio/mp4", "audio/aac", "audio/mpeg", "audio/wav", "audio/ogg",
]);

type AttachmentResourceRow = {
  workspace_id: string;
  project_status: ResourceStatus;
  board_status: ResourceStatus;
};

function parseAttachmentId(value: string): string {
  if (
    !value ||
    value.length > MAX_ATTACHMENT_ID_LENGTH ||
    !ATTACHMENT_ID_PATTERN.test(value)
  ) {
    throw new RequestError(400, "invalid_attachment_id");
  }
  return value;
}

function objectKey(
  workspaceId: string,
  projectId: string,
  boardId: string,
  attachmentId: string,
): string {
  return `workspaces/${workspaceId}/projects/${projectId}/boards/${boardId}/attachments/${attachmentId}`;
}

function allowedContentType(request: Request): string | null {
  const raw = request.headers.get("Content-Type");
  if (!raw) return null;
  const value = raw.split(";", 1)[0].trim().toLowerCase();
  return ALLOWED_ATTACHMENT_TYPES.has(value) ? value : null;
}

async function readBoundedBody(
  request: Request,
): Promise<Uint8Array | "empty" | "too_large"> {
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

async function getAttachmentResource(
  context: ApiContext,
  projectId: string,
  boardId: string,
  mutation: boolean,
): Promise<AttachmentResourceRow> {
  await authorizeProject(
    context.env.DB,
    context.user.id,
    projectId,
    mutation ? "edit" : "read",
  );
  const row = await context.env.DB.prepare(
    `SELECT projects.workspace_id,
            projects.status AS project_status,
            boards.status AS board_status
     FROM boards
     INNER JOIN projects ON projects.id = boards.project_id
     WHERE boards.id = ? AND boards.project_id = ?`,
  ).bind(boardId, projectId).first<AttachmentResourceRow>();
  if (!row) throw new RequestError(404, "not_found");
  if (
    mutation &&
    (row.project_status === "archived" || row.board_status === "archived")
  ) {
    throw new RequestError(409, "resource_archived");
  }
  return row;
}

async function getAttachment(
  context: ApiContext,
  key: string,
): Promise<Response> {
  const object = await context.env.ATTACHMENTS.get(key);
  if (!object) throw new RequestError(404, "not_found");
  const headers = responseHeaders(context.requestId);
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Content-Length", object.size.toString());
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

async function putAttachment(
  context: ApiContext,
  key: string,
  attachmentId: string,
): Promise<Response> {
  const length = context.request.headers.get("Content-Length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_ATTACHMENT_BYTES) {
    throw new RequestError(413, "attachment_too_large");
  }
  const contentType = allowedContentType(context.request);
  if (!contentType) throw new RequestError(415, "unsupported_attachment_type");
  const body = await readBoundedBody(context.request);
  if (body === "empty") throw new RequestError(400, "empty_attachment");
  if (body === "too_large") throw new RequestError(413, "attachment_too_large");
  const object = await context.env.ATTACHMENTS.put(key, body, {
    httpMetadata: { contentType },
  });
  return json(200, {
    ok: true,
    attachmentId,
    etag: object.httpEtag,
    requestId: context.requestId,
  }, context.requestId);
}

async function deleteAttachment(
  context: ApiContext,
  key: string,
  attachmentId: string,
): Promise<Response> {
  await context.env.ATTACHMENTS.delete(key);
  return json(200, {
    ok: true,
    attachmentId,
    requestId: context.requestId,
  }, context.requestId);
}

export async function handleAttachmentRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  const match = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/boards\/([0-9a-f-]+)\/attachments\/([^/]+)$/i,
  );
  if (!match) return null;
  if (
    context.request.method !== "GET" &&
    context.request.method !== "PUT" &&
    context.request.method !== "DELETE"
  ) {
    return null;
  }
  await requireMigrationComplete(context.env.DB);
  const projectId = parseUuid(match[1], "project_id");
  const boardId = parseUuid(match[2], "board_id");
  const attachmentId = parseAttachmentId(match[3]);
  const mutation = context.request.method !== "GET";
  const resource = await getAttachmentResource(context, projectId, boardId, mutation);
  const key = objectKey(resource.workspace_id, projectId, boardId, attachmentId);
  if (context.request.method === "GET") return getAttachment(context, key);
  if (context.request.method === "PUT") {
    return putAttachment(context, key, attachmentId);
  }
  return deleteAttachment(context, key, attachmentId);
}
