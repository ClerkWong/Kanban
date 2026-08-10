import { prepareAuditEvent } from "./audit";
import { authorizeProject } from "./authorization";
import { MAX_ASSIGNED_BOARDS } from "./board-access";
import type { ProjectRow } from "./db-types";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid, readJsonObject } from "./validation";

async function projectRow(database: D1Database, projectId: string): Promise<ProjectRow> {
  const row = await database.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId).first<ProjectRow>();
  if (!row) throw new RequestError(404, "not_found");
  return row;
}

async function requireProjectMember(
  database: D1Database,
  projectId: string,
  userId: string,
): Promise<void> {
  const row = await database.prepare(
    "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, userId).first<string>("user_id");
  if (!row) throw new RequestError(404, "user_not_found");
}

async function listAssignments(
  database: D1Database,
  projectId: string,
  userId: string,
): Promise<string[]> {
  const result = await database.prepare(
    `SELECT board_id FROM project_member_boards
     WHERE project_id = ? AND user_id = ?
     ORDER BY board_id`,
  ).bind(projectId, userId).all<{ board_id: string }>();
  return result.results.map((row) => row.board_id);
}

function parseBoardIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ASSIGNED_BOARDS) {
    throw new RequestError(400, "invalid_board_ids");
  }
  const ids = new Set<string>();
  for (const candidate of value) {
    let boardId: string;
    try {
      boardId = parseUuid(candidate, "board_id");
    } catch {
      throw new RequestError(400, "invalid_board_ids");
    }
    ids.add(boardId);
  }
  return [...ids];
}

async function requireBoardsInProject(
  database: D1Database,
  projectId: string,
  boardIds: string[],
): Promise<void> {
  if (!boardIds.length) return;
  const placeholders = boardIds.map(() => "?").join(", ");
  const found = await database.prepare(
    `SELECT id FROM boards WHERE project_id = ? AND id IN (${placeholders})`,
  ).bind(projectId, ...boardIds).all<{ id: string }>();
  if (found.results.length !== boardIds.length) {
    throw new RequestError(400, "invalid_board_ids");
  }
}

async function putAssignments(
  context: ApiContext,
  projectId: string,
  targetUserId: string,
): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  await requireProjectMember(context.env.DB, projectId, targetUserId);
  const body = await readJsonObject(context.request, ["boardIds"]);
  const boardIds = parseBoardIds(body.boardIds);
  await requireBoardsInProject(context.env.DB, projectId, boardIds);
  const project = await projectRow(context.env.DB, projectId);
  const now = new Date().toISOString();

  const statements = [
    context.env.DB.prepare(
      "DELETE FROM project_member_boards WHERE project_id = ? AND user_id = ?",
    ).bind(projectId, targetUserId),
    ...boardIds.map((boardId) => context.env.DB.prepare(
      `INSERT INTO project_member_boards (
         project_id, user_id, board_id, assigned_by, assigned_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectId, targetUserId, boardId, context.user.id, now)),
    prepareAuditEvent(context.env.DB, {
      id: crypto.randomUUID(),
      workspaceId: project.workspace_id,
      projectId,
      boardId: null,
      actorUserId: context.user.id,
      action: "member.boards_assigned",
      entityType: "membership" as const,
      entityId: targetUserId,
      revision: null,
      // 只記 ID，不記看板名稱或卡片內容。
      metadata: { userId: targetUserId, boardIds },
      occurredAt: now,
    }, true),
  ];
  await context.env.DB.batch(statements);
  return json(200, { boardIds, requestId: context.requestId }, context.requestId);
}

export async function handleMemberBoardsRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  const match = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/members\/([0-9a-f-]+)\/boards$/i,
  );
  if (!match) return null;
  await requireMigrationComplete(context.env.DB);
  const projectId = parseUuid(match[1], "project_id");
  const targetUserId = parseUuid(match[2], "user_id");

  if (context.request.method === "GET") {
    await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
    await requireProjectMember(context.env.DB, projectId, targetUserId);
    return json(200, {
      boardIds: await listAssignments(context.env.DB, projectId, targetUserId),
      requestId: context.requestId,
    }, context.requestId);
  }
  if (context.request.method === "PUT") {
    return putAssignments(context, projectId, targetUserId);
  }
  return null;
}
