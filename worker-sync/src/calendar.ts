import { AuthorizationError } from "./authorization";
import type { WorkspaceRole } from "./db-types";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

/** 單次請求最多展開的看板數；超出時回應標記 boardsTruncated。 */
export const MAX_CALENDAR_BOARDS = 50;
/** 未排程池上限；超出時回應標記 unscheduledTruncated。 */
export const MAX_UNSCHEDULED = 200;
/** scheduled 的防禦性上限：純粹避免單月卡量異常暴衝時把整個結果集拉爆，規格未要求
 *  對應的截斷旗標（50 個看板 × 每板逾 100 張本月卡才會觸及，實務上不該發生）。 */
const MAX_SCHEDULED = 5000;

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

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type CardRow = {
  project_id: string;
  project_name: string;
  board_id: string;
  board_name: string;
  card_id: string;
  title: string;
  due_date: string | null;
  blocked: number | null;
  service_class: string | null;
  assignee_ids: string | null;
};

type CalendarCard = {
  cardId: string;
  title: string;
  dueDate: string;
  assigneeUserIds: string[];
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
  blocked: boolean;
  serviceClass: string;
};

const SERVICE_CLASSES = ["standard", "expedite", "fixedDate", "intangible"];

function toCalendarCard(row: CardRow): CalendarCard {
  let assigneeUserIds: string[] = [];
  if (row.assignee_ids) {
    try {
      const parsed = JSON.parse(row.assignee_ids) as unknown;
      if (Array.isArray(parsed)) {
        assigneeUserIds = parsed.filter((id): id is string => typeof id === "string");
      }
    } catch {
      assigneeUserIds = [];
    }
  }
  const serviceClass = row.service_class && SERVICE_CLASSES.includes(row.service_class)
    ? row.service_class
    : "standard";
  return {
    cardId: row.card_id,
    title: row.title,
    dueDate: row.due_date ?? "",
    assigneeUserIds,
    projectId: row.project_id,
    projectName: row.project_name,
    boardId: row.board_id,
    boardName: row.board_name,
    blocked: Boolean(row.blocked),
    serviceClass,
  };
}

/** 展開範圍內 active 專案的 active 看板；以 updated_at 取前 MAX_CALENDAR_BOARDS 個。
 *  卡片藏在 boards.data 的 JSON blob 裡，因此用 json_each 在 SQL 層展開與過濾——
 *  已實測 D1 支援（見規格 §3.1），避免把整份 board JSON 拉進 Worker。
 *  WHERE 另有 cards.type = 'object' 守門：json_each 展開出的成員若非物件（例如
 *  $.cards 混入 scalar 值），對它求值的 json_extract 會噴 malformed JSON，這裡跳過
 *  而不是讓整份日曆 500，與 boards.ts／board-diff.ts 讀取路徑「非物件卡片一律跳過」
 *  的慣例一致。 */
function cardQuery(projectPlaceholders: string, dueClause: string, limit: number): string {
  return `SELECT projects.id AS project_id, projects.name AS project_name,
                 boards.id AS board_id, boards.name AS board_name,
                 cards.key AS card_id,
                 json_extract(cards.value, '$.title') AS title,
                 json_extract(cards.value, '$.dueDate') AS due_date,
                 json_extract(cards.value, '$.blocked') AS blocked,
                 json_extract(cards.value, '$.serviceClass') AS service_class,
                 json_extract(cards.value, '$.assigneeUserIds') AS assignee_ids
          FROM boards
          INNER JOIN projects ON projects.id = boards.project_id
          JOIN json_each(json_extract(boards.data, '$.cards')) AS cards
          WHERE boards.id IN (
                  SELECT boards.id FROM boards
                  WHERE boards.status = 'active'
                    AND boards.project_id IN (${projectPlaceholders})
                  ORDER BY boards.updated_at DESC, boards.id DESC
                  LIMIT ${MAX_CALENDAR_BOARDS}
                )
            AND projects.status = 'active'
            AND cards.type = 'object'
            AND json_extract(cards.value, '$.completedAt') IS NULL
            AND ${dueClause}
          ORDER BY due_date, projects.name COLLATE NOCASE, title
          LIMIT ${limit}`;
}

export async function handleCalendarRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (url.pathname !== "/calendar") return null;
  if (context.request.method !== "GET") return null;
  await requireMigrationComplete(context.env.DB);

  const workspaceId = parseUuid(url.searchParams.get("workspaceId"), "workspace_id");
  const month = url.searchParams.get("month") ?? "";
  if (!MONTH_PATTERN.test(month)) throw new RequestError(400, "invalid_month");

  const scope = await resolveCalendarScope(context.env.DB, context.user.id, workspaceId);
  if (!scope.projectIds.length) {
    return json(200, {
      month, scope: scope.kind, scheduled: [], unscheduled: [],
      unscheduledTruncated: false, boardsTruncated: false, assignees: [],
      requestId: context.requestId,
    }, context.requestId);
  }

  const placeholders = scope.projectIds.map(() => "?").join(", ");
  const boardCount = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM boards
     WHERE boards.status = 'active' AND boards.project_id IN (${placeholders})`,
  ).bind(...scope.projectIds).first<number>("n") ?? 0;

  const scheduledResult = await context.env.DB.prepare(
    cardQuery(placeholders, "json_extract(cards.value, '$.dueDate') LIKE ?", MAX_SCHEDULED),
  ).bind(...scope.projectIds, `${month}-%`).all<CardRow>();

  const unscheduledResult = await context.env.DB.prepare(
    cardQuery(
      placeholders,
      "(json_extract(cards.value, '$.dueDate') IS NULL OR json_extract(cards.value, '$.dueDate') = '')",
      MAX_UNSCHEDULED + 1,
    ),
  ).bind(...scope.projectIds).all<CardRow>();

  const scheduled = scheduledResult.results.map(toCalendarCard);
  const unscheduledAll = unscheduledResult.results.map(toCalendarCard);
  const unscheduledTruncated = unscheduledAll.length > MAX_UNSCHEDULED;
  const unscheduled = unscheduledAll.slice(0, MAX_UNSCHEDULED);

  const userIds = [...new Set(
    [...scheduled, ...unscheduled].flatMap((card) => card.assigneeUserIds),
  )];
  let assignees: Array<{ userId: string; displayName: string }> = [];
  if (userIds.length) {
    const namePlaceholders = userIds.map(() => "?").join(", ");
    const directory = await context.env.DB.prepare(
      `SELECT id, display_name FROM user_accounts WHERE id IN (${namePlaceholders})
       ORDER BY display_name COLLATE NOCASE, id`,
    ).bind(...userIds).all<{ id: string; display_name: string }>();
    assignees = directory.results.map((row) => ({
      userId: row.id,
      displayName: row.display_name,
    }));
  }

  return json(200, {
    month,
    scope: scope.kind,
    scheduled,
    unscheduled,
    unscheduledTruncated,
    boardsTruncated: boardCount > MAX_CALENDAR_BOARDS,
    assignees,
    requestId: context.requestId,
  }, context.requestId);
}
