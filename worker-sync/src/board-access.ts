import type { ProjectAccess } from "./authorization";
import { RequestError } from "./validation";

export const MAX_ASSIGNED_BOARDS = 50;

/** 主要看板：active 看板中最後更新者，同時間取 id 較大者（與 migration 0003 的
 *  preferred 判定同規則）。專案沒有 active 看板時回 null。 */
async function primaryBoardId(
  database: D1Database,
  projectId: string,
): Promise<string | null> {
  return await database.prepare(
    `SELECT id FROM boards
     WHERE project_id = ? AND status = 'active'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(projectId).first<string>("id");
}

/** 回傳 caller 在此專案可見的 board id 集合；null 代表全部可見。
 *  owner（manager）與 legacy viewer 恆全可見；member（contributor）依指派列，
 *  完全沒有指派列時 fallback 到主要看板。 */
export async function resolveVisibleBoardIds(
  database: D1Database,
  projectId: string,
  userId: string,
  access: ProjectAccess,
): Promise<Set<string> | null> {
  if (access.projectRole !== "contributor") return null;
  const assigned = await database.prepare(
    "SELECT board_id FROM project_member_boards WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, userId).all<{ board_id: string }>();
  if (assigned.results.length) {
    return new Set(assigned.results.map((row) => row.board_id));
  }
  const primary = await primaryBoardId(database, projectId);
  return new Set(primary ? [primary] : []);
}

/** 不可見時以 404 拒絕——403 會洩漏看板存在。 */
export async function requireBoardVisible(
  database: D1Database,
  projectId: string,
  boardId: string,
  userId: string,
  access: ProjectAccess,
): Promise<void> {
  const visible = await resolveVisibleBoardIds(database, projectId, userId, access);
  if (visible && !visible.has(boardId)) {
    throw new RequestError(404, "not_found");
  }
}
