import { prepareAuditEvent } from "./audit";
import { authorizeProject, AuthorizationError, hasProjectCapability } from "./authorization";
import {
  toPublicProjectRole,
  toStoredProjectRole,
  type ProjectRole,
  type ProjectRow,
  type WorkspaceRole,
} from "./db-types";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseProjectRole, parseUuid, readJsonObject } from "./validation";

type MemberRow = {
  user_id: string;
  display_name: string;
  role: ProjectRole;
  created_at: string;
  updated_at: string;
};

type MemberCandidateRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  project_role: ProjectRole | null;
};

function memberJson(row: MemberRow) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: toPublicProjectRole(row.role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function project(database: D1Database, projectId: string): Promise<ProjectRow> {
  const row = await database.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId).first<ProjectRow>();
  if (!row) throw new RequestError(404, "not_found");
  return row;
}

function audit(
  row: ProjectRow,
  actorUserId: string,
  targetUserId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  return {
    id: crypto.randomUUID(),
    workspaceId: row.workspace_id,
    projectId: row.id,
    boardId: null,
    actorUserId,
    action,
    entityType: "membership" as const,
    entityId: targetUserId,
    revision: null,
    metadata,
    occurredAt: new Date().toISOString(),
  };
}

async function listMembers(context: ApiContext, projectId: string): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  const result = await context.env.DB.prepare(
    `SELECT project_members.user_id, user_accounts.display_name,
            project_members.role, project_members.created_at, project_members.updated_at
     FROM project_members
     INNER JOIN user_accounts ON user_accounts.id = project_members.user_id
     WHERE project_members.project_id = ?
     ORDER BY user_accounts.display_name, project_members.user_id`,
  ).bind(projectId).all<MemberRow>();
  return json(200, {
    members: result.results.map(memberJson),
    requestId: context.requestId,
  }, context.requestId);
}

async function listMemberCandidates(context: ApiContext, projectId: string): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  const result = await context.env.DB.prepare(
    `SELECT user_accounts.id AS user_id, user_accounts.display_name, user_accounts.email,
            project_members.role AS project_role
     FROM projects
     INNER JOIN workspace_members
       ON workspace_members.workspace_id = projects.workspace_id
     INNER JOIN user_accounts
       ON user_accounts.id = workspace_members.user_id
      AND user_accounts.status = 'active'
     LEFT JOIN project_members
       ON project_members.project_id = projects.id
      AND project_members.user_id = user_accounts.id
     WHERE projects.id = ?
     ORDER BY user_accounts.display_name COLLATE NOCASE, user_accounts.id`,
  ).bind(projectId).all<MemberCandidateRow>();
  return json(200, {
    users: result.results.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      currentRole: row.project_role ? toPublicProjectRole(row.project_role) : null,
    })),
    requestId: context.requestId,
  }, context.requestId);
}

type MembershipAuthorization = { viaPlatformAdmin: boolean };

/** membership 寫入的授權：專案 owner，或 workspace owner／admin（平台管理平面）。
 *  放寬只作用於本檔的 PUT／DELETE；其餘 manage 操作仍走 authorizeProject。 */
async function authorizeMembershipManagement(
  database: D1Database,
  userId: string,
  projectId: string,
): Promise<MembershipAuthorization> {
  const row = await database.prepare(
    `SELECT workspace_members.role AS workspace_role,
            project_members.role AS project_role
     FROM projects
     LEFT JOIN workspace_members
       ON workspace_members.workspace_id = projects.workspace_id
      AND workspace_members.user_id = ?
     LEFT JOIN project_members
       ON project_members.project_id = projects.id
      AND project_members.user_id = ?
     WHERE projects.id = ?`,
  ).bind(userId, userId, projectId).first<{
    workspace_role: WorkspaceRole | null;
    project_role: ProjectRole | null;
  }>();
  if (!row) throw new AuthorizationError(404, "not_found");
  if (hasProjectCapability(row.project_role, "manage")) {
    return { viaPlatformAdmin: false };
  }
  if (row.workspace_role === "owner" || row.workspace_role === "admin") {
    return { viaPlatformAdmin: true };
  }
  // 既有行為：專案成員但權限不足回 403、非成員回 404（不洩漏專案存在）。
  if (row.project_role) throw new AuthorizationError(403, "forbidden");
  throw new AuthorizationError(404, "not_found");
}

async function putMember(
  context: ApiContext,
  projectId: string,
  targetUserId: string,
): Promise<Response> {
  const { viaPlatformAdmin } = await authorizeMembershipManagement(
    context.env.DB,
    context.user.id,
    projectId,
  );
  const body = await readJsonObject(context.request, ["role"]);
  const publicRole = parseProjectRole(body.role);
  const role = toStoredProjectRole(publicRole);
  const targetExists = await context.env.DB.prepare(
    `SELECT user_accounts.id
     FROM projects
     INNER JOIN workspace_members
       ON workspace_members.workspace_id = projects.workspace_id
      AND workspace_members.user_id = ?
     INNER JOIN user_accounts
       ON user_accounts.id = workspace_members.user_id
      AND user_accounts.status = 'active'
     WHERE projects.id = ?`,
  ).bind(targetUserId, projectId).first<string>("id");
  if (!targetExists) throw new RequestError(404, "user_not_found");
  const projectRow = await project(context.env.DB, projectId);
  const current = await context.env.DB.prepare(
    "SELECT role, created_at FROM project_members WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, targetUserId).first<{ role: ProjectRole; created_at: string }>();
  if (current?.role === role) {
    const row = await context.env.DB.prepare(
      `SELECT project_members.user_id, user_accounts.display_name,
              project_members.role, project_members.created_at, project_members.updated_at
       FROM project_members INNER JOIN user_accounts ON user_accounts.id = project_members.user_id
       WHERE project_members.project_id = ? AND project_members.user_id = ?`,
    ).bind(projectId, targetUserId).first<MemberRow>();
    return json(200, { member: row ? memberJson(row) : null, requestId: context.requestId }, context.requestId);
  }
  const now = new Date().toISOString();
  const statement = current
    ? context.env.DB.prepare(
      `UPDATE project_members SET role = ?, updated_at = ?
       WHERE project_id = ? AND user_id = ?
         AND (
           role != 'manager' OR ? = 'manager' OR
           EXISTS (
             SELECT 1 FROM project_members AS other
             INNER JOIN user_accounts
               ON user_accounts.id = other.user_id
              AND user_accounts.status = 'active'
             WHERE other.project_id = project_members.project_id
               AND other.role = 'manager' AND other.user_id != project_members.user_id
           )
         )`,
    ).bind(role, now, projectId, targetUserId, role)
    : context.env.DB.prepare(
      `INSERT INTO project_members (
        project_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectId, targetUserId, role, now, now);
  const results = await context.env.DB.batch([
    statement,
    prepareAuditEvent(context.env.DB, audit(
      projectRow,
      context.user.id,
      targetUserId,
      current ? "membership.role_changed" : "membership.added",
      {
        from: current?.role ?? null,
        to: role,
        ...(viaPlatformAdmin ? { via: "platform_admin" } : {}),
      },
    ), true),
  ]);
  if (!results[0].meta.changes) throw new RequestError(409, "last_owner");
  const row: MemberRow = {
    user_id: targetUserId,
    display_name: await context.env.DB.prepare(
      "SELECT display_name FROM user_accounts WHERE id = ?",
    ).bind(targetUserId).first<string>("display_name") ?? targetUserId,
    role,
    created_at: current?.created_at ?? now,
    updated_at: now,
  };
  return json(200, { member: memberJson(row), requestId: context.requestId }, context.requestId);
}

async function deleteMember(
  context: ApiContext,
  projectId: string,
  targetUserId: string,
): Promise<Response> {
  const { viaPlatformAdmin } = await authorizeMembershipManagement(
    context.env.DB,
    context.user.id,
    projectId,
  );
  const projectRow = await project(context.env.DB, projectId);
  const current = await context.env.DB.prepare(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, targetUserId).first<{ role: ProjectRole }>();
  if (!current) return json(200, { ok: true, requestId: context.requestId }, context.requestId);
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `DELETE FROM project_members
       WHERE project_id = ? AND user_id = ?
         AND (
           role != 'manager' OR
           EXISTS (
             SELECT 1 FROM project_members AS other
             INNER JOIN user_accounts
               ON user_accounts.id = other.user_id
              AND user_accounts.status = 'active'
             WHERE other.project_id = project_members.project_id
               AND other.role = 'manager' AND other.user_id != project_members.user_id
           )
         )`,
    ).bind(projectId, targetUserId),
    prepareAuditEvent(context.env.DB, audit(
      projectRow,
      context.user.id,
      targetUserId,
      "membership.removed",
      {
        from: current.role,
        ...(viaPlatformAdmin ? { via: "platform_admin" } : {}),
      },
    ), true),
  ]);
  if (!results[0].meta.changes) throw new RequestError(409, "last_owner");
  return json(200, { ok: true, requestId: context.requestId }, context.requestId);
}

export async function handleMembershipRequest(context: ApiContext): Promise<Response | null> {
  const pathname = new URL(context.request.url).pathname;
  const candidatesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/member-candidates$/i,
  );
  if (candidatesMatch) {
    await requireMigrationComplete(context.env.DB);
    const projectId = parseUuid(candidatesMatch[1], "project_id");
    return context.request.method === "GET"
      ? listMemberCandidates(context, projectId)
      : null;
  }
  const match = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/members(?:\/([0-9a-f-]+))?$/i,
  );
  if (!match) return null;
  await requireMigrationComplete(context.env.DB);
  const projectId = parseUuid(match[1], "project_id");
  if (!match[2] && context.request.method === "GET") return listMembers(context, projectId);
  if (!match[2]) return null;
  const userId = parseUuid(match[2], "user_id");
  if (context.request.method === "PUT") return putMember(context, projectId, userId);
  if (context.request.method === "DELETE") return deleteMember(context, projectId, userId);
  return null;
}
