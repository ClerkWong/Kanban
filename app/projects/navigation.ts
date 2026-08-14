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
  | { kind: "calendar"; month: string | null }
  | { kind: "resources"; from: string | null }
  | { kind: "project"; projectId: string }
  | { kind: "board"; projectId: string; boardId: string };

export type BoardAccess = {
  canEdit: boolean;
  canConfigureWorkflow: boolean;
  canWriteAttachments: boolean;
  canManageAssignments: boolean;
  readOnlyReason: string | null;
};

export function parseProjectHash(hash: string): ProjectRoute | null {
  const path = hash.replace(/^#/, "").replace(/^\/+|\/+$/g, "");
  if (!path || path === "projects") return { kind: "projects" };
  if (path === "admin") return { kind: "admin" };
  if (path === "calendar" || path.startsWith("calendar?")) {
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    const month = new URLSearchParams(query).get("month");
    return {
      kind: "calendar",
      month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    };
  }
  if (path === "resources" || path.startsWith("resources?")) {
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    const from = new URLSearchParams(query).get("from");
    return {
      kind: "resources",
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
    };
  }

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
  if (route.kind === "calendar") {
    return route.month ? `#/calendar?month=${route.month}` : "#/calendar";
  }
  if (route.kind === "resources") {
    return route.from ? `#/resources?from=${route.from}` : "#/resources";
  }
  if (route.kind === "project") return `#/projects/${route.projectId}`;
  return `#/projects/${route.projectId}/boards/${route.boardId}`;
}

/** 日曆與人力甘特圖皆是管理者專屬：workspace owner／admin，或任一 active 專案的
 * Project owner。兩個檢視共用同一組可見性判斷（見 resolveAuthorizedRoute 的
 * "calendar"／"resources" 分支），刻意不叫 canViewCalendar——那個名字會讓人誤以為
 * 只影響日曆，日後調整一邊的授權規則卻忘了甘特圖也吃同一個函式。 */
export function canViewManagerViews(
  projects: ProjectSummary[],
  allowAdmin: boolean,
): boolean {
  return allowAdmin || projects.some(
    (project) => project.myRole === "owner" && project.status === "active",
  );
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
  if (route?.kind === "calendar") {
    return canViewManagerViews(projects, allowAdmin) ? route : { kind: "projects" };
  }
  if (route?.kind === "resources") {
    return canViewManagerViews(projects, allowAdmin) ? route : { kind: "projects" };
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
      canManageAssignments: false,
      readOnlyReason: "此專案已封存，目前為唯讀模式。",
    };
  }
  if (boardStatus === "archived") {
    return {
      canEdit: false,
      canConfigureWorkflow: false,
      canWriteAttachments: false,
      canManageAssignments: false,
      readOnlyReason: "此看板已封存，目前為唯讀模式。",
    };
  }
  if (!canEditBoard(role)) {
    return {
      canEdit: false,
      canConfigureWorkflow: false,
      canWriteAttachments: false,
      canManageAssignments: false,
      readOnlyReason: "你的專案角色是檢視者，目前為唯讀模式。",
    };
  }
  return {
    canEdit: true,
    canConfigureWorkflow: canManageProject(role),
    canWriteAttachments: canWriteAttachment(role),
    canManageAssignments: canManageProject(role),
    readOnlyReason: null,
  };
}

export function projectRoleLabel(role: ProjectRole): string {
  if (role === "owner") return "專案 Owner";
  if (role === "member") return "專案 Member";
  return "唯讀成員（舊版）";
}
