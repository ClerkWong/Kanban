// Domain types for multi-project / multi-board (v1).
//
// This module is a pure type layer: no storage, no network, no D1 access.
// Shapes here are the authoritative canonical names agreed across
// client/Worker -- do not invent alternate names elsewhere. See:
//   docs/superpowers/specs/2026-07-24-multi-project-multi-board-design.md
//     §7 角色與授權 (role matrix)
//     §8 領域模型 (Workspace / User / AccessToken / Project / ProjectMembership
//                  / BoardRecord / ActivityLog)
//   docs/superpowers/plans/2026-07-24-multi-project-multi-board-v1.md
//     "Shared API and model decisions" (canonical type names)

/** Workspace-level role. Governs workspace administration only -- see
 * §7.3: a workspace role must never auto-grant Project content permission.
 * Workspace admins/owners only gain Project access by becoming a
 * `ProjectMembership` like anyone else, which is logged. */
export type WorkspaceRole = "owner" | "admin" | "member";

/** Project-level role. This is the only axis that grants Project/Board
 * content capabilities (see app/projects/model.ts capability functions). */
/** User-facing Project roles. `viewer` is retained only for legacy read-only
 * memberships and cannot be assigned to new members from the UI. */
export type ProjectRole = "owner" | "member" | "viewer";

export type ResourceStatus = "active" | "archived";

/** Identifies the Board a client is currently viewing/editing. Required by
 * every per-board fetch/push call in the v2 API. */
export type BoardContext = {
  workspaceId: string;
  projectId: string;
  boardId: string;
};

/** Server-side Project record (design spec §8.3). */
export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  status: ResourceStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
};

/** A single user's role within a single Project (design spec §8.3). A user
 * may hold a different role in each Project they belong to. This is
 * referenced by `Card.assigneeUserIds`. The legacy `Card.members: string[]`
 * field remains display-only and never participates in authorization. */
export type ProjectMembership = {
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
};

/** Board *metadata* only -- board *content* is the existing `BoardState`
 * (see app/board-model.ts), stored and parsed separately. Project name is
 * never copied onto `BoardMeta.name`, and renaming one never cascades to
 * the other (design spec §8.4). */
export type BoardMeta = {
  id: string;
  projectId: string;
  name: string;
  status: ResourceStatus;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
};

/** One row of the caller's "我的專案" list. `GET /projects` only returns the
 * caller's own memberships (design spec §7.3, §10.1): Project name, the
 * caller's own role, how many active Boards it has, and when it was last
 * active. This intentionally carries no cross-Project aggregates. */
export type ProjectSummary = {
  id: string;
  name: string;
  status: ResourceStatus;
  myRole: ProjectRole;
  activeBoardCount: number;
  boardId: string | null;
  boardName: string | null;
  lastActivityAt: string | null;
};

/** Workspace-administration registry row. This intentionally exposes only
 * Project and single-Board metadata plus owner ids; it never contains Card data. */
export type AdminProjectSummary = {
  id: string;
  workspaceId: string;
  name: string;
  status: ResourceStatus;
  ownerIds: string[];
  boardId: string | null;
  boardName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserSummary = {
  id: string;
  displayName: string;
  email: string | null;
  status: "active" | "disabled";
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  hasPassword: boolean;
  projectCount: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Append-only activity log entry (design spec §8.5). Produced by the
 * Worker only; clients never create, edit, or delete these. */
export type ActivityLogEntry = {
  id: string;
  workspaceId: string;
  projectId: string;
  boardId: string | null;
  actorUserId: string;
  action: string;
  entityType: "project" | "membership" | "board" | "card" | "attachment";
  entityId: string;
  revision: number | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};
