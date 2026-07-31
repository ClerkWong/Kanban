import type { ProjectRole, ResourceStatus, WorkspaceRole } from "./db-types";

export type ProjectCapability = "read" | "edit" | "manage";
export type ProjectAccess = {
  workspaceRole: WorkspaceRole | null;
  projectRole: ProjectRole | null;
  projectStatus: ResourceStatus;
};

type AccessRow = {
  workspace_role: WorkspaceRole | null;
  project_role: ProjectRole | null;
  project_status: ResourceStatus;
};

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 403 | 404,
    public readonly code: "not_found" | "forbidden",
  ) {
    super(code);
  }
}

export function hasProjectCapability(
  role: ProjectRole | null,
  capability: ProjectCapability,
): boolean {
  if (!role) return false;
  if (capability === "read") return true;
  if (capability === "edit") return role === "manager" || role === "contributor";
  return role === "manager";
}

export async function authorizeProject(
  database: D1Database,
  userId: string,
  projectId: string,
  capability: ProjectCapability,
): Promise<ProjectAccess> {
  const row = await database.prepare(
    `SELECT workspace_members.role AS workspace_role,
            project_members.role AS project_role,
            projects.status AS project_status
     FROM projects
     LEFT JOIN workspace_members
       ON workspace_members.workspace_id = projects.workspace_id
      AND workspace_members.user_id = ?
     LEFT JOIN project_members
       ON project_members.project_id = projects.id
      AND project_members.user_id = ?
     WHERE projects.id = ?`,
  ).bind(userId, userId, projectId).first<AccessRow>();

  if (!row || !row.project_role) throw new AuthorizationError(404, "not_found");
  if (!hasProjectCapability(row.project_role, capability)) {
    throw new AuthorizationError(403, "forbidden");
  }
  return {
    workspaceRole: row.workspace_role,
    projectRole: row.project_role,
    projectStatus: row.project_status,
  };
}
