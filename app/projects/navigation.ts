import {
  canEditBoard,
  canManageProject,
  canWriteAttachment,
  isServerResourceId,
} from "./model";
import type {
  BoardContext,
  BoardMeta,
  ProjectRole,
  ProjectSummary,
  ResourceStatus,
} from "./types";

export type ProjectRoute =
  | { kind: "projects" }
  | { kind: "admin" }
  | { kind: "project"; projectId: string }
  | { kind: "board"; projectId: string; boardId: string };

export type BoardAccess = {
  canEdit: boolean;
  canConfigureWorkflow: boolean;
  canWriteAttachments: boolean;
  readOnlyReason: string | null;
};

export function parseProjectHash(hash: string): ProjectRoute | null {
  const path = hash.replace(/^#/, "").replace(/^\/+|\/+$/g, "");
  if (!path || path === "projects") return { kind: "projects" };
  if (path === "admin") return { kind: "admin" };

  const segments = path.split("/");
  if (
    segments.length === 2 &&
    segments[0] === "projects" &&
    isServerResourceId(segments[1])
  ) {
    return { kind: "project", projectId: segments[1] };
  }
  if (
    segments.length === 4 &&
    segments[0] === "projects" &&
    segments[2] === "boards" &&
    isServerResourceId(segments[1]) &&
    isServerResourceId(segments[3])
  ) {
    return {
      kind: "board",
      projectId: segments[1],
      boardId: segments[3],
    };
  }
  return null;
}

export function serializeProjectRoute(route: ProjectRoute): string {
  if (route.kind === "projects") return "#/projects";
  if (route.kind === "admin") return "#/admin";
  if (route.kind === "project") return `#/projects/${route.projectId}`;
  return `#/projects/${route.projectId}/boards/${route.boardId}`;
}

export function resolveAuthorizedRoute(
  route: ProjectRoute | null,
  projects: ProjectSummary[],
  lastContext: BoardContext | null = null,
  allowAdmin = false,
): ProjectRoute {
  if (route?.kind === "projects") return route;
  if (route?.kind === "admin") {
    return allowAdmin ? route : { kind: "projects" };
  }
  if (
    route &&
    projects.some((project) => project.id === route.projectId)
  ) {
    return route;
  }
  if (
    lastContext &&
    projects.some((project) => project.id === lastContext.projectId)
  ) {
    return {
      kind: "board",
      projectId: lastContext.projectId,
      boardId: lastContext.boardId,
    };
  }
  return { kind: "projects" };
}

export function boardBelongsToRoute(
  route: Extract<ProjectRoute, { kind: "board" }>,
  boards: BoardMeta[],
): boolean {
  return boards.some(
    (board) => board.id === route.boardId && board.projectId === route.projectId,
  );
}

export function deriveBoardAccess(
  role: ProjectRole,
  projectStatus: ResourceStatus,
  boardStatus: ResourceStatus,
): BoardAccess {
  if (projectStatus === "archived") {
    return {
      canEdit: false,
      canConfigureWorkflow: false,
      canWriteAttachments: false,
      readOnlyReason: "此專案已封存，目前為唯讀模式。",
    };
  }
  if (boardStatus === "archived") {
    return {
      canEdit: false,
      canConfigureWorkflow: false,
      canWriteAttachments: false,
      readOnlyReason: "此看板已封存，目前為唯讀模式。",
    };
  }
  if (!canEditBoard(role)) {
    return {
      canEdit: false,
      canConfigureWorkflow: false,
      canWriteAttachments: false,
      readOnlyReason: "你的專案角色是檢視者，目前為唯讀模式。",
    };
  }
  return {
    canEdit: true,
    canConfigureWorkflow: canManageProject(role),
    canWriteAttachments: canWriteAttachment(role),
    readOnlyReason: null,
  };
}

export function projectRoleLabel(role: ProjectRole): string {
  if (role === "owner") return "專案 Owner";
  if (role === "member") return "專案 Member";
  return "唯讀成員（舊版）";
}
