export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const LEGACY_SHARED_USER_ID = "00000000-0000-4000-8000-000000000002";
export const LEGACY_PROJECT_ID = "00000000-0000-4000-8000-000000000003";
export const LEGACY_BOARD_ID = "00000000-0000-4000-8000-000000000004";

export type WorkspaceRole = "owner" | "admin" | "member";
export type ProjectRole = "manager" | "contributor" | "viewer";
export type PublicProjectRole = "owner" | "member" | "viewer";
export type ResourceStatus = "active" | "archived";
export type UserStatus = "active" | "disabled";
export type TokenKind = "personal" | "legacy";
export type MigrationStatus = "pending" | "locked" | "complete";

export function toPublicProjectRole(role: ProjectRole): PublicProjectRole {
  if (role === "manager") return "owner";
  if (role === "contributor") return "member";
  return "viewer";
}

export function toStoredProjectRole(role: PublicProjectRole): ProjectRole {
  if (role === "owner") return "manager";
  if (role === "member") return "contributor";
  return "viewer";
}

export type WorkspaceRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type UserAccountRow = {
  id: string;
  display_name: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
};

export type AccessTokenRow = {
  id: string;
  user_id: string;
  label: string;
  token_hash: string;
  token_kind: TokenKind;
  legacy_user_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  normalized_name: string;
  status: ResourceStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
};

export type BoardRow = {
  id: string;
  project_id: string;
  name: string;
  normalized_name: string;
  status: ResourceStatus;
  revision: number;
  data: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
};

export type MigrationStateRow = {
  id: 1;
  status: MigrationStatus;
  default_workspace_id: string;
  legacy_project_id: string;
  legacy_board_id: string;
  locked_at: string | null;
  completed_at: string | null;
  updated_at: string;
  error: string | null;
};
