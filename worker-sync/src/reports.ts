import { authorizeProject } from "./authorization";
import { parseBoardSnapshot, type BoardSnapshot } from "./board-diff";
import type { ResourceStatus } from "./db-types";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

const REPORT_TIME_ZONE = "Asia/Taipei";
const RECENT_MONTH_COUNT = 6;
const DONE_COLUMN_ID = "done";

type ReportBoardRow = {
  id: string;
  name: string;
  status: ResourceStatus;
  revision: number;
  data: string;
};

type BoardReport = {
  id: string;
  name: string;
  status: ResourceStatus;
  revision: number;
  stats: {
    total: number;
    active: number;
    completed: number;
    overdue: number;
  };
};

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function dateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthKey(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const { year, month } = zonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function recentMonthKeys(now: Date, count: number, timeZone: string): string[] {
  const { year, month } = zonedDateParts(now, timeZone);
  return Array.from({ length: count }, (_, index) => {
    const offset = index - count + 1;
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function summarizeBoard(
  row: Omit<ReportBoardRow, "data">,
  board: BoardSnapshot,
  today: string,
): BoardReport {
  const doneIds = new Set(
    board.columns.find((column) => column.id === DONE_COLUMN_ID)?.cardIds ?? [],
  );
  const cards = Object.values(board.cards);
  const completed = cards.filter((card) => doneIds.has(card.id)).length;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    revision: row.revision,
    stats: {
      total: cards.length,
      active: cards.length - completed,
      completed,
      overdue: cards.filter(
        (card) =>
          /^\d{4}-\d{2}-\d{2}$/.test(card.dueDate) &&
          card.dueDate < today &&
          !doneIds.has(card.id),
      ).length,
    },
  };
}

export function buildProjectSummary(
  rows: ReportBoardRow[],
  includeArchived: boolean,
  now = new Date(),
  timeZone = REPORT_TIME_ZONE,
) {
  const today = dateKey(now, timeZone);
  const months = recentMonthKeys(now, RECENT_MONTH_COUNT, timeZone);
  const monthlyCounts = new Map(months.map((month) => [month, 0]));
  const boards: BoardReport[] = [];

  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.data);
    } catch {
      value = null;
    }
    const board = parseBoardSnapshot(value) ?? { columns: [], cards: {} };
    boards.push(summarizeBoard(row, board, today));
    const doneIds = new Set(
      board.columns.find((column) => column.id === DONE_COLUMN_ID)?.cardIds ?? [],
    );
    for (const card of Object.values(board.cards)) {
      if (!doneIds.has(card.id) || !card.completedAt) continue;
      const month = monthKey(card.completedAt, timeZone);
      if (month && monthlyCounts.has(month)) {
        monthlyCounts.set(month, (monthlyCounts.get(month) ?? 0) + 1);
      }
    }
  }

  const stats = boards.reduce(
    (total, board) => ({
      total: total.total + board.stats.total,
      active: total.active + board.stats.active,
      completed: total.completed + board.stats.completed,
      overdue: total.overdue + board.stats.overdue,
    }),
    { total: 0, active: 0, completed: 0, overdue: 0 },
  );
  return {
    includeArchived,
    boardCount: boards.length,
    stats,
    monthlyCompletions: months.map((month) => ({
      month,
      monthLabel: `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`,
      count: monthlyCounts.get(month) ?? 0,
    })),
    boards,
    generatedAt: now.toISOString(),
    timeZone,
  };
}

export async function handleReportRequest(context: ApiContext): Promise<Response | null> {
  const url = new URL(context.request.url);
  const match = url.pathname.match(/^\/projects\/([0-9a-f-]+)\/summary$/i);
  if (!match) return null;
  if (context.request.method !== "GET") return null;
  await requireMigrationComplete(context.env.DB);
  const projectId = parseUuid(match[1], "project_id");
  await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  const rawIncludeArchived = url.searchParams.get("includeArchived");
  if (
    rawIncludeArchived !== null &&
    rawIncludeArchived !== "true" &&
    rawIncludeArchived !== "false"
  ) {
    throw new RequestError(400, "invalid_include_archived");
  }
  const includeArchived = rawIncludeArchived === "true";
  const result = await context.env.DB.prepare(
    `SELECT id, name, status, revision, data
     FROM boards
     WHERE project_id = ? AND (? = 1 OR status = 'active')
     ORDER BY updated_at DESC, id DESC`,
  ).bind(projectId, includeArchived ? 1 : 0).all<ReportBoardRow>();
  return json(200, {
    projectId,
    summary: buildProjectSummary(result.results, includeArchived),
    requestId: context.requestId,
  }, context.requestId);
}
