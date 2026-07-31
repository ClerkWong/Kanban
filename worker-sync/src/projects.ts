import type { AuthenticatedUser } from "./auth";
import { prepareAuditEvent } from "./audit";
import { AuthorizationError, authorizeProject } from "./authorization";
import { DEFAULT_WORKSPACE_ID, type ProjectRole, type ProjectRow } from "./db-types";
import { json } from "./http";
import {
  RequestError,
  isConstraintConflict,
  normalizeName,
  parseUuid,
  readJsonObject,
} from "./validation";
import { sha256Hex } from "./logic";

export type ApiContext = {
  request: Request;
  env: Env;
  user: AuthenticatedUser;
  requestId: string;
};

type ProjectListRow = ProjectRow & {
  my_role: ProjectRole;
  active_board_count: number;
  last_activity_at: string | null;
};

function projectJson(row: ProjectRow, myRole?: ProjectRole) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    status: row.status,
    ...(myRole ? { myRole } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

export async function requireMigrationComplete(database: D1Database): Promise<void> {
  const status = await database.prepare(
    "SELECT status FROM migration_state WHERE id = 1",
  ).first<string>("status");
  if (status !== "complete") throw new RequestError(503, "migration_required");
}

async function getProjectRow(database: D1Database, id: string): Promise<ProjectRow> {
  const row = await database.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(id).first<ProjectRow>();
  if (!row) throw new RequestError(404, "not_found");
  return row;
}

function audit(row: ProjectRow, actorUserId: string, action: string, metadata: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    workspaceId: row.workspace_id,
    projectId: row.id,
    boardId: null,
    actorUserId,
    action,
    entityType: "project" as const,
    entityId: row.id,
    revision: null,
    metadata,
    occurredAt: new Date().toISOString(),
  };
}

async function listProjects(context: ApiContext): Promise<Response> {
  const includeArchived = new URL(context.request.url).searchParams.get("status") === "archived";
  const result = await context.env.DB.prepare(
    `SELECT projects.*, project_members.role AS my_role,
            (SELECT COUNT(*) FROM boards
             WHERE boards.project_id = projects.id AND boards.status = 'active') AS active_board_count,
            (SELECT MAX(activity_logs.occurred_at) FROM activity_logs
             WHERE activity_logs.project_id = projects.id) AS last_activity_at
     FROM project_members
     INNER JOIN projects ON projects.id = project_members.project_id
     WHERE project_members.user_id = ? AND projects.status = ?
     ORDER BY projects.updated_at DESC, projects.id DESC`,
  ).bind(context.user.id, includeArchived ? "archived" : "active").all<ProjectListRow>();
  return json(200, {
    projects: result.results.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      myRole: row.my_role,
      activeBoardCount: Number(row.active_board_count),
      lastActivityAt: row.last_activity_at,
    })),
    requestId: context.requestId,
  }, context.requestId);
}

async function listAdminProjects(context: ApiContext): Promise<Response> {
  const result = await context.env.DB.prepare(
    `SELECT projects.id, projects.name, projects.status,
            projects.created_at, projects.updated_at,
            (
              SELECT group_concat(project_members.user_id)
              FROM project_members
              WHERE project_members.project_id = projects.id
                AND project_members.role = 'manager'
            ) AS manager_ids
     FROM projects
     INNER JOIN workspace_members
       ON workspace_members.workspace_id = projects.workspace_id
      AND workspace_members.user_id = ?
      AND workspace_members.role IN ('owner', 'admin')
     ORDER BY projects.updated_at DESC, projects.id DESC`,
  ).bind(context.user.id).all<{
    id: string;
    name: string;
    status: string;
    created_at: string;
    updated_at: string;
    manager_ids: string | null;
  }>();
  return json(200, {
    projects: result.results.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      managerIds: row.manager_ids ? row.manager_ids.split(",") : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    requestId: context.requestId,
  }, context.requestId);
}

async function createProject(context: ApiContext): Promise<Response> {
  const body = await readJsonObject(context.request, ["id", "workspaceId", "name"]);
  const id = parseUuid(body.id, "project_id");
  const workspaceId = parseUuid(body.workspaceId ?? DEFAULT_WORKSPACE_ID, "workspace_id");
  const { name, normalizedName } = normalizeName(body.name);
  const workspaceRole = await context.env.DB.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, context.user.id).first<string>("role");
  if (workspaceRole !== "owner" && workspaceRole !== "admin") {
    throw new AuthorizationError(403, "forbidden");
  }
  const existing = await context.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(id).first<ProjectRow>();
  if (existing) {
    const role = await context.env.DB.prepare(
      "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    ).bind(id, context.user.id).first<ProjectRole>("role");
    if (
      existing.workspace_id === workspaceId &&
      existing.name === name &&
      role
    ) {
      return json(200, {
        project: projectJson(existing, role),
        requestId: context.requestId,
      }, context.requestId);
    }
    throw new RequestError(409, "project_id_conflict");
  }
  const now = new Date().toISOString();
  const row: ProjectRow = {
    id, workspace_id: workspaceId, name, normalized_name: normalizedName,
    status: "active", created_by: context.user.id, created_at: now, updated_at: now,
    archived_at: null, archived_by: null,
  };
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO projects (
          id, workspace_id, name, normalized_name, status, created_by,
          created_at, updated_at, archived_at, archived_by
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL)`,
      ).bind(id, workspaceId, name, normalizedName, context.user.id, now, now),
      context.env.DB.prepare(
        `INSERT INTO project_members (
          project_id, user_id, role, created_at, updated_at
        ) VALUES (?, ?, 'manager', ?, ?)`,
      ).bind(id, context.user.id, now, now),
      prepareAuditEvent(context.env.DB, audit(row, context.user.id, "project.created", { name })),
    ]);
  } catch (error) {
    if (isConstraintConflict(error)) throw new RequestError(409, "name_conflict");
    throw error;
  }
  return json(201, { project: projectJson(row, "manager"), requestId: context.requestId }, context.requestId);
}

async function getProject(context: ApiContext, projectId: string): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  const row = await getProjectRow(context.env.DB, projectId);
  return json(200, {
    project: projectJson(row, access.projectRole ?? undefined),
    requestId: context.requestId,
  }, context.requestId);
}

async function updateProject(
  context: ApiContext,
  projectId: string,
  action: "rename" | "archive" | "restore",
): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  const row = await getProjectRow(context.env.DB, projectId);
  let statement: D1PreparedStatement;
  let next: ProjectRow;
  let actionName: string;
  let metadata: Record<string, unknown>;
  const now = new Date().toISOString();
  if (action === "rename") {
    const body = await readJsonObject(context.request, ["name"]);
    const normalized = normalizeName(body.name);
    if (row.name === normalized.name) {
      return json(200, { project: projectJson(row, "manager"), requestId: context.requestId }, context.requestId);
    }
    next = { ...row, name: normalized.name, normalized_name: normalized.normalizedName, updated_at: now };
    statement = context.env.DB.prepare(
      "UPDATE projects SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
    ).bind(next.name, next.normalized_name, now, projectId);
    actionName = "project.renamed";
    metadata = { from: row.name, to: next.name };
  } else {
    const target = action === "archive" ? "archived" : "active";
    if (row.status === target) {
      return json(200, { project: projectJson(row, "manager"), requestId: context.requestId }, context.requestId);
    }
    next = {
      ...row,
      status: target,
      updated_at: now,
      archived_at: target === "archived" ? now : null,
      archived_by: target === "archived" ? context.user.id : null,
    };
    statement = context.env.DB.prepare(
      "UPDATE projects SET status = ?, updated_at = ?, archived_at = ?, archived_by = ? WHERE id = ?",
    ).bind(target, now, next.archived_at, next.archived_by, projectId);
    actionName = action === "archive" ? "project.archived" : "project.restored";
    metadata = {};
  }
  try {
    await context.env.DB.batch([
      statement,
      prepareAuditEvent(context.env.DB, audit(next, context.user.id, actionName, metadata), true),
    ]);
  } catch (error) {
    if (isConstraintConflict(error)) throw new RequestError(409, "name_conflict");
    throw error;
  }
  return json(200, { project: projectJson(next, "manager"), requestId: context.requestId }, context.requestId);
}

export async function handleProjectRequest(context: ApiContext): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/me") && !url.pathname.startsWith("/projects") && url.pathname !== "/admin/projects") {
    return null;
  }
  await requireMigrationComplete(context.env.DB);
  if (
    url.pathname === "/me/replace-legacy-token" &&
    context.request.method === "POST"
  ) {
    if (context.user.tokenKind !== "legacy") {
      throw new RequestError(409, "token_not_legacy");
    }
    const body = await readJsonObject(context.request, ["newToken"], 8192);
    if (
      typeof body.newToken !== "string" ||
      body.newToken.length < 32 ||
      body.newToken.length > 4096 ||
      /\s/.test(body.newToken)
    ) {
      throw new RequestError(400, "invalid_token");
    }
    const newTokenHash = await sha256Hex(body.newToken);
    const replacement = await context.env.DB.prepare(
      `SELECT access_tokens.id, access_tokens.user_id
       FROM access_tokens
       INNER JOIN user_accounts ON user_accounts.id = access_tokens.user_id
       WHERE access_tokens.token_hash = ?
         AND access_tokens.token_kind = 'personal'
         AND access_tokens.revoked_at IS NULL
         AND user_accounts.status = 'active'`,
    ).bind(newTokenHash).first<{ id: string; user_id: string }>();
    if (!replacement) throw new RequestError(400, "invalid_replacement_token");
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `UPDATE access_tokens SET revoked_at = ?
       WHERE id = ? AND token_kind = 'legacy' AND revoked_at IS NULL`,
    ).bind(now, context.user.tokenId).run();
    if (!result.meta.changes) throw new RequestError(409, "token_already_replaced");
    return json(200, {
      userId: replacement.user_id,
      tokenKind: "personal",
      requestId: context.requestId,
    }, context.requestId);
  }
  if (url.pathname === "/me" && context.request.method === "GET") {
    const memberships = await context.env.DB.prepare(
      "SELECT workspace_id, role FROM workspace_members WHERE user_id = ?",
    ).bind(context.user.id).all<{ workspace_id: string; role: string }>();
    return json(200, {
      user: {
        id: context.user.id,
        displayName: context.user.displayName,
        tokenKind: context.user.tokenKind,
      },
      workspaces: memberships.results.map((row) => ({ workspaceId: row.workspace_id, role: row.role })),
      requestId: context.requestId,
    }, context.requestId);
  }
  if (url.pathname === "/projects") {
    if (context.request.method === "GET") return listProjects(context);
    if (context.request.method === "POST") return createProject(context);
    return null;
  }
  if (url.pathname === "/admin/projects" && context.request.method === "GET") {
    return listAdminProjects(context);
  }
  const match = url.pathname.match(/^\/projects\/([0-9a-f-]+)(?:\/(archive|restore))?$/i);
  if (!match) return null;
  const projectId = parseUuid(match[1], "project_id");
  if (!match[2] && context.request.method === "GET") return getProject(context, projectId);
  if (!match[2] && context.request.method === "PATCH") return updateProject(context, projectId, "rename");
  if (match[2] && context.request.method === "POST") return updateProject(context, projectId, match[2] as "archive" | "restore");
  return null;
}
