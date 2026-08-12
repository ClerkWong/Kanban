import { AuthorizationError } from "./authorization";
import type { ApiContext } from "./projects";
import {
  toPublicProjectRole,
  type ProjectRole,
  type ResourceStatus,
  type WorkspaceRole,
} from "./db-types";
import { json } from "./http";
import { hashPassword, normalizeEmail, parsePassword } from "./passwords";
import {
  RequestError,
  isConstraintConflict,
  parseUuid,
  readJsonObject,
} from "./validation";

type WorkspaceMembershipRow = {
  user_id: string;
  role: WorkspaceRole;
  status: "active" | "disabled";
};

type AdminUserRow = {
  id: string;
  display_name: string;
  email: string | null;
  status: "active" | "disabled";
  workspace_role: WorkspaceRole;
  has_password: number;
  project_count: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new RequestError(400, "invalid_display_name");
  const displayName = value.trim();
  if (!displayName || displayName.length > 80) {
    throw new RequestError(400, "invalid_display_name");
  }
  return displayName;
}

function parseAssignableWorkspaceRole(value: unknown): "admin" | "member" {
  if (value !== "admin" && value !== "member") {
    throw new RequestError(400, "invalid_workspace_role");
  }
  return value;
}

function parseUserStatus(value: unknown): "active" | "disabled" {
  if (value !== "active" && value !== "disabled") {
    throw new RequestError(400, "invalid_user_status");
  }
  return value;
}

async function requireWorkspaceAdmin(
  context: ApiContext,
  workspaceId: string,
): Promise<WorkspaceRole> {
  const role = await context.env.DB.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, context.user.id).first<WorkspaceRole>("role");
  if (role !== "owner" && role !== "admin") {
    throw new AuthorizationError(404, "not_found");
  }
  return role;
}

async function getTargetMembership(
  context: ApiContext,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembershipRow> {
  const row = await context.env.DB.prepare(
    `SELECT workspace_members.user_id, workspace_members.role, user_accounts.status
     FROM workspace_members
     INNER JOIN user_accounts ON user_accounts.id = workspace_members.user_id
     WHERE workspace_members.workspace_id = ? AND workspace_members.user_id = ?`,
  ).bind(workspaceId, userId).first<WorkspaceMembershipRow>();
  if (!row) throw new RequestError(404, "user_not_found");
  return row;
}

function workspaceAudit(
  context: ApiContext,
  workspaceId: string,
  action: string,
  targetUserId: string,
  metadata: Record<string, unknown>,
  occurredAt: string,
): D1PreparedStatement {
  return context.env.DB.prepare(
    `INSERT INTO workspace_activity_logs (
       id, workspace_id, actor_user_id, action, target_user_id, metadata, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    workspaceId,
    context.user.id,
    action,
    targetUserId,
    JSON.stringify(metadata),
    occurredAt,
  );
}

async function listUsers(context: ApiContext, workspaceId: string): Promise<Response> {
  await requireWorkspaceAdmin(context, workspaceId);
  const result = await context.env.DB.prepare(
    `SELECT user_accounts.id, user_accounts.display_name, user_accounts.email,
            user_accounts.status, workspace_members.role AS workspace_role,
            CASE WHEN password_credentials.user_id IS NULL THEN 0 ELSE 1 END AS has_password,
            COUNT(DISTINCT projects.id) AS project_count,
            MAX(COALESCE(user_sessions.last_used_at, user_sessions.created_at)) AS last_login_at,
            user_accounts.created_at, user_accounts.updated_at
     FROM workspace_members
     INNER JOIN user_accounts ON user_accounts.id = workspace_members.user_id
     LEFT JOIN password_credentials ON password_credentials.user_id = user_accounts.id
     LEFT JOIN project_members ON project_members.user_id = user_accounts.id
     LEFT JOIN projects
       ON projects.id = project_members.project_id
      AND projects.workspace_id = workspace_members.workspace_id
     LEFT JOIN user_sessions ON user_sessions.user_id = user_accounts.id
     WHERE workspace_members.workspace_id = ?
     GROUP BY user_accounts.id, workspace_members.role
     ORDER BY CASE workspace_members.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              user_accounts.display_name COLLATE NOCASE, user_accounts.id`,
  ).bind(workspaceId).all<AdminUserRow>();
  return json(200, {
    users: result.results.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      status: row.status,
      workspaceId,
      workspaceRole: row.workspace_role,
      hasPassword: Boolean(row.has_password),
      projectCount: Number(row.project_count),
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    requestId: context.requestId,
  }, context.requestId);
}

async function createUser(context: ApiContext): Promise<Response> {
  const body = await readJsonObject(
    context.request,
    ["workspaceId", "displayName", "email", "password", "workspaceRole"],
    8192,
  );
  const workspaceId = parseUuid(body.workspaceId, "workspace_id");
  await requireWorkspaceAdmin(context, workspaceId);
  const displayName = normalizeDisplayName(body.displayName);
  const { email, normalizedEmail } = normalizeEmail(body.email);
  const password = parsePassword(body.password);
  const workspaceRole = parseAssignableWorkspaceRole(body.workspaceRole);
  const credential = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO user_accounts (
           id, display_name, status, created_at, updated_at, email, normalized_email
         ) VALUES (?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(id, displayName, now, now, email, normalizedEmail),
      context.env.DB.prepare(
        `INSERT INTO password_credentials (
           user_id, algorithm, iterations, salt, password_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        credential.algorithm,
        credential.iterations,
        credential.salt,
        credential.passwordHash,
        now,
      ),
      context.env.DB.prepare(
        `INSERT INTO workspace_members (
           workspace_id, user_id, role, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(workspaceId, id, workspaceRole, now, now),
      workspaceAudit(
        context,
        workspaceId,
        "user.created",
        id,
        { workspaceRole, email },
        now,
      ),
    ]);
  } catch (error) {
    if (isConstraintConflict(error)) throw new RequestError(409, "email_conflict");
    throw error;
  }
  return json(201, {
    user: {
      id,
      displayName,
      email,
      status: "active",
      workspaceId,
      workspaceRole,
      hasPassword: true,
      projectCount: 0,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    },
    requestId: context.requestId,
  }, context.requestId);
}

async function updateUser(
  context: ApiContext,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  const actorRole = await requireWorkspaceAdmin(context, workspaceId);
  const target = await getTargetMembership(context, workspaceId, userId);
  if (target.role === "owner" && actorRole !== "owner") {
    throw new RequestError(403, "owner_protected");
  }
  const body = await readJsonObject(
    context.request,
    ["displayName", "email", "status", "workspaceRole"],
    8192,
  );
  if (Object.keys(body).length === 0) throw new RequestError(400, "invalid_payload");
  const displayName = body.displayName === undefined
    ? null
    : normalizeDisplayName(body.displayName);
  const email = body.email === undefined ? null : normalizeEmail(body.email);
  const status = body.status === undefined ? null : parseUserStatus(body.status);
  const workspaceRole = body.workspaceRole === undefined
    ? null
    : parseAssignableWorkspaceRole(body.workspaceRole);
  if (target.role === "owner" && workspaceRole) {
    throw new RequestError(409, "owner_role_locked");
  }
  if (target.role === "owner" && status === "disabled") {
    throw new RequestError(409, "owner_protected");
  }
  if (
    userId === context.user.id &&
    (status === "disabled" || (workspaceRole && workspaceRole !== target.role))
  ) {
    throw new RequestError(409, "cannot_remove_own_access");
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (displayName || email || status) {
    statements.push(context.env.DB.prepare(
      `UPDATE user_accounts SET
         display_name = COALESCE(?, display_name),
         email = COALESCE(?, email),
         normalized_email = COALESCE(?, normalized_email),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      displayName,
      email?.email ?? null,
      email?.normalizedEmail ?? null,
      status,
      now,
      userId,
    ));
  }
  if (workspaceRole) {
    statements.push(context.env.DB.prepare(
      "UPDATE workspace_members SET role = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?",
    ).bind(workspaceRole, now, workspaceId, userId));
  }
  if (status === "disabled") {
    statements.push(
      context.env.DB.prepare(
        "UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, userId),
      context.env.DB.prepare(
        "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, userId),
    );
  }
  statements.push(workspaceAudit(
    context,
    workspaceId,
    "user.updated",
    userId,
    {
      ...(displayName ? { displayName } : {}),
      ...(email ? { email: email.email } : {}),
      ...(status ? { status } : {}),
      ...(workspaceRole ? { workspaceRole } : {}),
    },
    now,
  ));
  try {
    await context.env.DB.batch(statements);
  } catch (error) {
    if (isConstraintConflict(error)) throw new RequestError(409, "email_conflict");
    throw error;
  }
  return json(200, { ok: true, requestId: context.requestId }, context.requestId);
}

async function resetPassword(
  context: ApiContext,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  const actorRole = await requireWorkspaceAdmin(context, workspaceId);
  const target = await getTargetMembership(context, workspaceId, userId);
  if (target.role === "owner" && actorRole !== "owner") {
    throw new RequestError(403, "owner_protected");
  }
  if (target.status !== "active") throw new RequestError(409, "user_disabled");
  const body = await readJsonObject(context.request, ["password"], 4096);
  const credential = await hashPassword(parsePassword(body.password));
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO password_credentials (
         user_id, algorithm, iterations, salt, password_hash, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         algorithm = excluded.algorithm,
         iterations = excluded.iterations,
         salt = excluded.salt,
         password_hash = excluded.password_hash,
         updated_at = excluded.updated_at`,
    ).bind(
      userId,
      credential.algorithm,
      credential.iterations,
      credential.salt,
      credential.passwordHash,
      now,
    ),
    context.env.DB.prepare(
      "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    ).bind(now, userId),
    workspaceAudit(
      context,
      workspaceId,
      "user.password_reset",
      userId,
      {},
      now,
    ),
  ]);
  return json(200, { ok: true, requestId: context.requestId }, context.requestId);
}

type UserProjectRow = {
  project_id: string;
  project_name: string;
  status: ResourceStatus;
  role: ProjectRole;
};

async function listUserProjects(
  context: ApiContext,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  await requireWorkspaceAdmin(context, workspaceId);
  await getTargetMembership(context, workspaceId, userId);
  const result = await context.env.DB.prepare(
    `SELECT projects.id AS project_id, projects.name AS project_name,
            projects.status AS status, project_members.role AS role
     FROM project_members
     INNER JOIN projects ON projects.id = project_members.project_id
     WHERE project_members.user_id = ? AND projects.workspace_id = ?
     ORDER BY projects.name COLLATE NOCASE, projects.id`,
  ).bind(userId, workspaceId).all<UserProjectRow>();
  return json(200, {
    userId,
    memberships: result.results.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      role: toPublicProjectRole(row.role),
      status: row.status,
    })),
    requestId: context.requestId,
  }, context.requestId);
}

export async function handleUserRequest(context: ApiContext): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/admin/users")) return null;

  if (url.pathname === "/admin/users" && context.request.method === "GET") {
    const workspaceId = parseUuid(url.searchParams.get("workspaceId"), "workspace_id");
    return listUsers(context, workspaceId);
  }
  if (url.pathname === "/admin/users" && context.request.method === "POST") {
    return createUser(context);
  }
  const match = url.pathname.match(
    /^\/admin\/users\/([0-9a-f-]+)(?:\/(password|projects))?$/i,
  );
  if (!match) return null;
  const userId = parseUuid(match[1], "user_id");
  const workspaceId = parseUuid(url.searchParams.get("workspaceId"), "workspace_id");
  if (!match[2] && context.request.method === "PATCH") {
    return updateUser(context, workspaceId, userId);
  }
  if (match[2] === "password" && context.request.method === "POST") {
    return resetPassword(context, workspaceId, userId);
  }
  if (match[2] === "projects" && context.request.method === "GET") {
    return listUserProjects(context, workspaceId, userId);
  }
  return null;
}
