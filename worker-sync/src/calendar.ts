import { AuthorizationError } from "./authorization";
import type { WorkspaceRole } from "./db-types";

/** 單次請求最多展開的看板數；超出時回應標記 boardsTruncated。 */
export const MAX_CALENDAR_BOARDS = 50;
/** 未排程池上限；超出時回應標記 unscheduledTruncated。 */
export const MAX_UNSCHEDULED = 200;

export type CalendarScope = {
  kind: "workspace" | "owned_projects";
  projectIds: string[];
};

/** 日曆可見範圍：workspace owner／admin 得到整個 workspace 的 active 專案；
 *  Project owner 只得到他 own 的；其餘 403；非 workspace 成員 404（不洩漏）。 */
export async function resolveCalendarScope(
  database: D1Database,
  userId: string,
  workspaceId: string,
): Promise<CalendarScope> {
  const workspaceRole = await database.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, userId).first<WorkspaceRole>("role");
  if (!workspaceRole) throw new AuthorizationError(404, "not_found");

  if (workspaceRole === "owner" || workspaceRole === "admin") {
    const all = await database.prepare(
      `SELECT id FROM projects
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY name COLLATE NOCASE, id`,
    ).bind(workspaceId).all<{ id: string }>();
    return { kind: "workspace", projectIds: all.results.map((row) => row.id) };
  }

  const owned = await database.prepare(
    `SELECT projects.id AS id
     FROM projects
     INNER JOIN project_members
       ON project_members.project_id = projects.id
      AND project_members.user_id = ?
      AND project_members.role = 'manager'
     WHERE projects.workspace_id = ? AND projects.status = 'active'
     ORDER BY projects.name COLLATE NOCASE, projects.id`,
  ).bind(userId, workspaceId).all<{ id: string }>();
  if (!owned.results.length) throw new AuthorizationError(403, "forbidden");
  return { kind: "owned_projects", projectIds: owned.results.map((row) => row.id) };
}
