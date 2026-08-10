import { authorizeProject } from "./authorization";
import { requireBoardVisible, resolveVisibleBoardIds } from "./board-access";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_CURSOR_LENGTH = 512;

type ActivityLogRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  board_id: string | null;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  revision: number | null;
  metadata: string;
  occurred_at: string;
};

type LogCursor = {
  occurredAt: string;
  id: string;
};

function parseLimit(value: string | null): number {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value)) throw new RequestError(400, "invalid_limit");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_PAGE_SIZE) {
    throw new RequestError(400, "invalid_limit");
  }
  return limit;
}

function encodeCursor(cursor: LogCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(value: string | null): LogCursor | null {
  if (value === null) return null;
  if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RequestError(400, "invalid_cursor");
  }
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("occurredAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.occurredAt !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.occurredAt ||
      !parsed.id
    ) {
      throw new Error("invalid cursor payload");
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new RequestError(400, "invalid_cursor");
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function logJson(row: ActivityLogRow, visible: Set<string> | null) {
  const metadata = parseMetadata(row.metadata);
  // Board 可見性 v1（審查回合 1 修正）：project-level 事件（board_id 為 NULL，例如
  // project.created）仍可能在 metadata 裡挾帶「這件事跟哪塊看板有關」的
  // boardId／boardName（初始看板名稱）。row 層級的可見性過濾只看 activity_logs
  // 自己的 board_id 欄位，管不到 metadata 內嵌欄位；這裡補第二層：metadata.boardId
  // 不在可見集合（或不是字串）時剔除 boardId／boardName，同一事件其餘欄位
  // （name／ownerUserId 等）不受影響。board.created 事件已用 activity_logs.board_id
  // 欄位獨立記錄同一份資訊，剔除 metadata 副本不會丟失稽核資料。owner／viewer
  // （visible 為 null）不受影響，維持完整 metadata；既有 D1 列不需要資料清洗，
  // 這層在每次讀取時套用。
  if (row.board_id === null && visible) {
    const boardId = metadata.boardId;
    if (typeof boardId !== "string" || !visible.has(boardId)) {
      delete metadata.boardId;
      delete metadata.boardName;
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId: row.board_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    revision: row.revision,
    metadata,
    occurredAt: row.occurred_at,
  };
}

async function listLogs(
  context: ApiContext,
  projectId: string,
  boardId: string | null,
): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  if (boardId) {
    // board 參數為 optional：只在有指定時檢查，且必須在任何資源性 D1 讀寫之前完成。
    await requireBoardVisible(context.env.DB, projectId, boardId, context.user.id, access);
    const exists = await context.env.DB.prepare(
      "SELECT 1 FROM boards WHERE id = ? AND project_id = ?",
    ).bind(boardId, projectId).first<number>();
    if (!exists) throw new RequestError(404, "not_found");
  }
  // 未指定 boardId 的 project-scoped 查詢：可見範圍要到查詢時才知道（contributor
  // 的指派列或 fallback 主要看板都是動態集合），改在序列化前濾除結果中不可見
  // board 的事件，而不是整個 400/404 掉——project-level 事件（board_id 為 null）
  // 不受影響。
  const visible = boardId
    ? null
    : await resolveVisibleBoardIds(context.env.DB, projectId, context.user.id, access);

  const url = new URL(context.request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const clauses = ["project_id = ?"];
  const bindings: Array<string | number> = [projectId];
  if (boardId) {
    clauses.push("board_id = ?");
    bindings.push(boardId);
  }
  if (cursor) {
    clauses.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
    bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  bindings.push(limit + 1);
  const result = await context.env.DB.prepare(
    `SELECT id, workspace_id, project_id, board_id, actor_user_id, action,
            entity_type, entity_id, revision, metadata, occurred_at
     FROM activity_logs
     WHERE ${clauses.join(" AND ")}
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
  ).bind(...bindings).all<ActivityLogRow>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  // 分頁邊界（cursor/nextCursor）刻意以濾除可見性前的 rows 計算，確保跨頁不會
  // 跳過或重複事件；代價是單頁實際回傳筆數可能小於 limit（此頁事件多數不可見
  // 時），視為 v1 可接受的已知限制。board-scoped 查詢（有指定 boardId）不會
  // 進到這裡的過濾，因為 requireBoardVisible 已經在前面擋掉整個 board 不可見
  // 的情況，visible 恆為 null。
  const visibleRows = visible
    ? rows.filter((row) => row.board_id === null || visible.has(row.board_id))
    : rows;
  return json(200, {
    logs: visibleRows.map((row) => logJson(row, visible)),
    nextCursor: result.results.length > limit && last
      ? encodeCursor({ occurredAt: last.occurred_at, id: last.id })
      : null,
    requestId: context.requestId,
  }, context.requestId);
}

export async function handleLogRequest(context: ApiContext): Promise<Response | null> {
  if (context.request.method !== "GET") return null;
  const pathname = new URL(context.request.url).pathname;
  const boardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/boards\/([0-9a-f-]+)\/logs$/i,
  );
  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/logs$/i);
  if (!boardMatch && !projectMatch) return null;
  await requireMigrationComplete(context.env.DB);
  if (boardMatch) {
    return listLogs(
      context,
      parseUuid(boardMatch[1], "project_id"),
      parseUuid(boardMatch[2], "board_id"),
    );
  }
  return listLogs(context, parseUuid(projectMatch![1], "project_id"), null);
}
