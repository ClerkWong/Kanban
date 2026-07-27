import { authorizeProject } from "./authorization";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_CURSOR_LENGTH = 512;

type ActivityLogRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  board_id: string | null;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  revision: number | null;
  metadata: string;
  occurred_at: string;
};

type LogCursor = {
  occurredAt: string;
  id: string;
};

function parseLimit(value: string | null): number {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value)) throw new RequestError(400, "invalid_limit");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_PAGE_SIZE) {
    throw new RequestError(400, "invalid_limit");
  }
  return limit;
}

function encodeCursor(cursor: LogCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(value: string | null): LogCursor | null {
  if (value === null) return null;
  if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RequestError(400, "invalid_cursor");
  }
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("occurredAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.occurredAt !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.occurredAt ||
      !parsed.id
    ) {
      throw new Error("invalid cursor payload");
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new RequestError(400, "invalid_cursor");
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function logJson(row: ActivityLogRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId: row.board_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    revision: row.revision,
    metadata: parseMetadata(row.metadata),
    occurredAt: row.occurred_at,
  };
}

async function listLogs(
  context: ApiContext,
  projectId: string,
  boardId: string | null,
): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  if (boardId) {
    const exists = await context.env.DB.prepare(
      "SELECT 1 FROM boards WHERE id = ? AND project_id = ?",
    ).bind(boardId, projectId).first<number>();
    if (!exists) throw new RequestError(404, "not_found");
  }

  const url = new URL(context.request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const clauses = ["project_id = ?"];
  const bindings: Array<string | number> = [projectId];
  if (boardId) {
    clauses.push("board_id = ?");
    bindings.push(boardId);
  }
  if (cursor) {
    clauses.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
    bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  bindings.push(limit + 1);
  const result = await context.env.DB.prepare(
    `SELECT id, workspace_id, project_id, board_id, actor_user_id, action,
            entity_type, entity_id, revision, metadata, occurred_at
     FROM activity_logs
     WHERE ${clauses.join(" AND ")}
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
  ).bind(...bindings).all<ActivityLogRow>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  return json(200, {
    logs: rows.map(logJson),
    nextCursor: result.results.length > limit && last
      ? encodeCursor({ occurredAt: last.occurred_at, id: last.id })
      : null,
    requestId: context.requestId,
  }, context.requestId);
}

export async function handleLogRequest(context: ApiContext): Promise<Response | null> {
  if (context.request.method !== "GET") return null;
  const pathname = new URL(context.request.url).pathname;
  const boardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/boards\/([0-9a-f-]+)\/logs$/i,
  );
  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/logs$/i);
  if (!boardMatch && !projectMatch) return null;
  await requireMigrationComplete(context.env.DB);
  if (boardMatch) {
    return listLogs(
      context,
      parseUuid(boardMatch[1], "project_id"),
      parseUuid(boardMatch[2], "board_id"),
    );
  }
  return listLogs(context, parseUuid(projectMatch![1], "project_id"), null);
}
