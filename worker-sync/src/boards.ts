import { prepareAuditEvent } from "./audit";
import { authorizeProject, type ProjectAccess } from "./authorization";
import { diffBoardStates } from "./board-diff";
import type { BoardRow, MigrationStateRow, ProjectRow } from "./db-types";
import { json } from "./http";
import { parseBoardPutPayload } from "./logic";
import { requireMigrationComplete, type ApiContext } from "./projects";
import {
  RequestError,
  isConstraintConflict,
  normalizeName,
  parseUuid,
  readJsonObject,
} from "./validation";

const MAX_BOARD_BYTES = 1_000_000;
const MAX_ASSIGNEES_PER_CARD = 20;
const MAX_ASSIGNEES_PER_BOARD = 100;

type BoardListRow = Omit<BoardRow, "data">;
type LegacyBoardRow = {
  revision: number;
  data: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function collectAssigneeUserIds(value: unknown, strict: boolean): Set<string> {
  const cards = asRecord(asRecord(value)?.cards);
  const result = new Set<string>();
  if (!cards) return result;

  for (const card of Object.values(cards)) {
    const raw = asRecord(card)?.assigneeUserIds;
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.length > MAX_ASSIGNEES_PER_CARD) {
      if (strict) throw new RequestError(400, "invalid_assignees");
      continue;
    }
    const perCard = new Set<string>();
    for (const candidate of raw) {
      let userId: string;
      try {
        userId = parseUuid(candidate, "assignee_user_id");
      } catch {
        if (strict) throw new RequestError(400, "invalid_assignees");
        continue;
      }
      if (perCard.has(userId)) {
        if (strict) throw new RequestError(400, "invalid_assignees");
        continue;
      }
      perCard.add(userId);
      result.add(userId);
      if (result.size > MAX_ASSIGNEES_PER_BOARD) {
        if (strict) throw new RequestError(400, "invalid_assignees");
        return result;
      }
    }
  }
  return result;
}

async function requireNewAssigneesAreProjectMembers(
  database: D1Database,
  projectId: string,
  previousBoard: unknown,
  nextBoard: unknown,
): Promise<void> {
  const previous = collectAssigneeUserIds(previousBoard, false);
  const added = [...collectAssigneeUserIds(nextBoard, true)]
    .filter((userId) => !previous.has(userId));
  if (!added.length) return;

  const placeholders = added.map(() => "?").join(", ");
  const current = await database.prepare(
    `SELECT user_id FROM project_members
     WHERE project_id = ? AND user_id IN (${placeholders})`,
  ).bind(projectId, ...added).all<{ user_id: string }>();
  const currentIds = new Set(current.results.map((row) => row.user_id));
  if (added.some((userId) => !currentIds.has(userId))) {
    throw new RequestError(400, "assignee_not_project_member");
  }
}

function boardMetadata(row: BoardListRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    revision: row.revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

function boardDetail(row: BoardRow) {
  return {
    ...boardMetadata(row),
    content: {
      revision: row.revision,
      board: JSON.parse(row.data) as unknown,
    },
  };
}

function boardAudit(
  project: ProjectRow,
  board: BoardRow,
  actorUserId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  return {
    id: crypto.randomUUID(),
    workspaceId: project.workspace_id,
    projectId: project.id,
    boardId: board.id,
    actorUserId,
    action,
    entityType: "board" as const,
    entityId: board.id,
    revision: board.revision,
    metadata,
    occurredAt: new Date().toISOString(),
  };
}

async function getProject(database: D1Database, projectId: string): Promise<ProjectRow> {
  const row = await database.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId).first<ProjectRow>();
  if (!row) throw new RequestError(404, "not_found");
  return row;
}

async function getBoard(
  database: D1Database,
  projectId: string,
  boardId: string,
): Promise<BoardRow> {
  const row = await database.prepare(
    "SELECT * FROM boards WHERE id = ? AND project_id = ?",
  ).bind(boardId, projectId).first<BoardRow>();
  if (!row) throw new RequestError(404, "not_found");
  return row;
}

function requireActive(access: ProjectAccess, board?: BoardRow): void {
  if (access.projectStatus === "archived" || board?.status === "archived") {
    throw new RequestError(409, "resource_archived");
  }
}

async function listBoards(context: ApiContext, projectId: string): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  const rawStatus = new URL(context.request.url).searchParams.get("status") ?? "active";
  if (rawStatus !== "active" && rawStatus !== "archived") {
    throw new RequestError(400, "invalid_status");
  }
  const result = await context.env.DB.prepare(
    `SELECT id, project_id, name, normalized_name, status, revision,
            created_by, created_at, updated_at, archived_at, archived_by
     FROM boards
     WHERE project_id = ? AND status = ?
     ORDER BY updated_at DESC, id DESC`,
  ).bind(projectId, rawStatus).all<BoardListRow>();
  return json(200, {
    boards: result.results.map(boardMetadata),
    requestId: context.requestId,
  }, context.requestId);
}

async function createBoard(context: ApiContext, projectId: string): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  requireActive(access);
  const body = await readJsonObject(
    context.request,
    ["id", "name", "board"],
    MAX_BOARD_BYTES,
    "board_too_large",
  );
  const id = parseUuid(body.id, "board_id");
  const normalized = normalizeName(body.name);
  if (!parseBoardPutPayload({ baseRevision: 0, board: body.board })) {
    throw new RequestError(400, "invalid_payload");
  }
  await requireNewAssigneesAreProjectMembers(
    context.env.DB,
    projectId,
    null,
    body.board,
  );
  const data = JSON.stringify(body.board);
  const existing = await context.env.DB.prepare("SELECT * FROM boards WHERE id = ?")
    .bind(id).first<BoardRow>();
  if (existing) {
    if (
      existing.project_id === projectId &&
      existing.name === normalized.name &&
      existing.revision === 0 &&
      existing.data === data
    ) {
      return json(200, {
        board: boardDetail(existing),
        requestId: context.requestId,
      }, context.requestId);
    }
    throw new RequestError(409, "board_id_conflict");
  }
  const project = await getProject(context.env.DB, projectId);
  const now = new Date().toISOString();
  const row: BoardRow = {
    id,
    project_id: projectId,
    name: normalized.name,
    normalized_name: normalized.normalizedName,
    status: "active",
    revision: 0,
    data,
    created_by: context.user.id,
    created_at: now,
    updated_at: now,
    archived_at: null,
    archived_by: null,
  };
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO boards (
           id, project_id, name, normalized_name, status, revision, data,
           created_by, created_at, updated_at, archived_at, archived_by
         ) SELECT ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, NULL, NULL
         WHERE EXISTS (
           SELECT 1 FROM projects WHERE id = ? AND status = 'active'
         )`,
      ).bind(
        id,
        projectId,
        row.name,
        row.normalized_name,
        data,
        context.user.id,
        now,
        now,
        projectId,
      ),
      prepareAuditEvent(
        context.env.DB,
        boardAudit(project, row, context.user.id, "board.created", { name: row.name }),
        true,
      ),
    ]);
  } catch (error) {
    if (isConstraintConflict(error)) {
      const retry = await context.env.DB.prepare("SELECT * FROM boards WHERE id = ?")
        .bind(id).first<BoardRow>();
      if (
        retry?.project_id === projectId &&
        retry.name === normalized.name &&
        retry.revision === 0 &&
        retry.data === data
      ) {
        return json(200, {
          board: boardDetail(retry),
          requestId: context.requestId,
        }, context.requestId);
      }
      const nameTaken = await context.env.DB.prepare(
        `SELECT id FROM boards
         WHERE project_id = ? AND normalized_name = ? AND status = 'active'`,
      ).bind(projectId, normalized.normalizedName).first<string>("id");
      throw new RequestError(409, nameTaken ? "name_conflict" : "board_id_conflict");
    }
    throw error;
  }
  const created = await context.env.DB.prepare("SELECT * FROM boards WHERE id = ?")
    .bind(id).first<BoardRow>();
  if (!created) throw new RequestError(409, "resource_archived");
  return json(201, {
    board: boardDetail(created),
    requestId: context.requestId,
  }, context.requestId);
}

async function getBoardDetail(
  context: ApiContext,
  projectId: string,
  boardId: string,
): Promise<Response> {
  await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  const row = await getBoard(context.env.DB, projectId, boardId);
  return json(200, {
    board: boardDetail(row),
    requestId: context.requestId,
  }, context.requestId);
}

async function renameBoard(
  context: ApiContext,
  projectId: string,
  boardId: string,
): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  const row = await getBoard(context.env.DB, projectId, boardId);
  requireActive(access);
  const body = await readJsonObject(context.request, ["name"]);
  const normalized = normalizeName(body.name);
  if (row.name === normalized.name) {
    return json(200, { board: boardMetadata(row), requestId: context.requestId }, context.requestId);
  }
  const project = await getProject(context.env.DB, projectId);
  const now = new Date().toISOString();
  const next = {
    ...row,
    name: normalized.name,
    normalized_name: normalized.normalizedName,
    updated_at: now,
  };
  try {
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE boards SET name = ?, normalized_name = ?, updated_at = ?
         WHERE id = ? AND project_id = ?
           AND EXISTS (
             SELECT 1 FROM projects WHERE id = ? AND status = 'active'
           )`,
      ).bind(next.name, next.normalized_name, now, boardId, projectId, projectId),
      prepareAuditEvent(
        context.env.DB,
        boardAudit(project, next, context.user.id, "board.renamed", {
          from: row.name,
          to: next.name,
        }),
        true,
      ),
    ]);
    if (!results[0].meta.changes) {
      const current = await getBoard(context.env.DB, projectId, boardId);
      if (current.name === next.name) {
        return json(200, {
          board: boardMetadata(current),
          requestId: context.requestId,
        }, context.requestId);
      }
      const currentAccess = await authorizeProject(
        context.env.DB,
        context.user.id,
        projectId,
        "manage",
      );
      requireActive(currentAccess);
      throw new RequestError(409, "board_changed");
    }
  } catch (error) {
    if (isConstraintConflict(error)) throw new RequestError(409, "name_conflict");
    throw error;
  }
  return json(200, {
    board: boardMetadata(next),
    requestId: context.requestId,
  }, context.requestId);
}

async function changeBoardStatus(
  context: ApiContext,
  projectId: string,
  boardId: string,
  action: "archive" | "restore",
): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "manage");
  if (access.projectStatus === "archived") throw new RequestError(409, "resource_archived");
  const row = await getBoard(context.env.DB, projectId, boardId);
  const target = action === "archive" ? "archived" : "active";
  if (row.status === target) {
    return json(200, { board: boardMetadata(row), requestId: context.requestId }, context.requestId);
  }
  const project = await getProject(context.env.DB, projectId);
  const now = new Date().toISOString();
  const next: BoardRow = {
    ...row,
    status: target,
    updated_at: now,
    archived_at: target === "archived" ? now : null,
    archived_by: target === "archived" ? context.user.id : null,
  };
  try {
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE boards
         SET status = ?, updated_at = ?, archived_at = ?, archived_by = ?
         WHERE id = ? AND project_id = ? AND status = ?
           AND EXISTS (
             SELECT 1 FROM projects WHERE id = ? AND status = 'active'
           )`,
      ).bind(
        target,
        now,
        next.archived_at,
        next.archived_by,
        boardId,
        projectId,
        row.status,
        projectId,
      ),
      prepareAuditEvent(
        context.env.DB,
        boardAudit(
          project,
          next,
          context.user.id,
          action === "archive" ? "board.archived" : "board.restored",
          {},
        ),
        true,
      ),
    ]);
    if (!results[0].meta.changes) {
      const current = await getBoard(context.env.DB, projectId, boardId);
      const currentAccess = await authorizeProject(
        context.env.DB,
        context.user.id,
        projectId,
        "manage",
      );
      if (currentAccess.projectStatus === "archived") {
        throw new RequestError(409, "resource_archived");
      }
      if (current.status === target) {
        return json(200, {
          board: boardMetadata(current),
          requestId: context.requestId,
        }, context.requestId);
      }
      throw new RequestError(409, "board_changed");
    }
  } catch (error) {
    if (isConstraintConflict(error)) throw new RequestError(409, "name_conflict");
    throw error;
  }
  return json(200, {
    board: boardMetadata(next),
    requestId: context.requestId,
  }, context.requestId);
}

async function putBoardContent(
  context: ApiContext,
  projectId: string,
  boardId: string,
): Promise<Response> {
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "edit");
  const row = await getBoard(context.env.DB, projectId, boardId);
  requireActive(access, row);
  const body = await readJsonObject(
    context.request,
    ["baseRevision", "board"],
    MAX_BOARD_BYTES,
    "board_too_large",
  );
  const payload = parseBoardPutPayload(body);
  if (!payload) throw new RequestError(400, "invalid_payload");
  if (payload.baseRevision !== row.revision) {
    return boardConflict(row, context.requestId);
  }
  await requireNewAssigneesAreProjectMembers(
    context.env.DB,
    projectId,
    JSON.parse(row.data) as unknown,
    payload.board,
  );
  const project = await getProject(context.env.DB, projectId);
  const nextRevision = row.revision + 1;
  const now = new Date().toISOString();
  const next: BoardRow = {
    ...row,
    revision: nextRevision,
    data: JSON.stringify(payload.board),
    updated_at: now,
  };
  const diff = diffBoardStates(JSON.parse(row.data) as unknown, payload.board);
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE boards SET revision = ?, data = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND revision = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM projects WHERE id = ? AND status = 'active'
         )`,
    ).bind(
      nextRevision,
      next.data,
      now,
      boardId,
      projectId,
      payload.baseRevision,
      projectId,
    ),
    prepareAuditEvent(
      context.env.DB,
      boardAudit(project, next, context.user.id, "board.content_updated", {
        fromRevision: row.revision,
        toRevision: nextRevision,
        changes: diff.changes,
        counts: diff.counts,
        truncated: diff.truncated,
      }),
      true,
    ),
  ]);
  if (!results[0].meta.changes) {
    const current = await getBoard(context.env.DB, projectId, boardId);
    const currentAccess = await authorizeProject(
      context.env.DB,
      context.user.id,
      projectId,
      "read",
    );
    requireActive(currentAccess, current);
    return boardConflict(current, context.requestId);
  }
  return json(200, { revision: nextRevision, requestId: context.requestId }, context.requestId);
}

function boardConflict(row: LegacyBoardRow, requestId: string): Response {
  return json(409, {
    revision: row.revision,
    board: JSON.parse(row.data) as unknown,
    requestId,
  }, requestId);
}

async function getMigrationState(database: D1Database): Promise<MigrationStateRow> {
  const state = await database.prepare("SELECT * FROM migration_state WHERE id = 1")
    .first<MigrationStateRow>();
  if (!state) throw new RequestError(503, "migration_required");
  return state;
}

async function getLegacyBoard(database: D1Database): Promise<LegacyBoardRow | null> {
  return database.prepare("SELECT revision, data FROM board WHERE id = 1")
    .first<LegacyBoardRow>();
}

async function putLegacyRow(context: ApiContext): Promise<Response> {
  const body = await readJsonObject(
    context.request,
    ["baseRevision", "board"],
    MAX_BOARD_BYTES,
    "board too large",
  );
  const payload = parseBoardPutPayload(body);
  if (!payload) {
    return json(400, { error: "invalid payload", requestId: context.requestId }, context.requestId);
  }
  const row = await getLegacyBoard(context.env.DB);
  if (payload.baseRevision !== (row?.revision ?? 0)) {
    return row
      ? boardConflict(row, context.requestId)
      : json(409, {
        revision: 0,
        board: null,
        requestId: context.requestId,
      }, context.requestId);
  }
  const data = JSON.stringify(payload.board);
  const now = new Date().toISOString();
  if (!row) {
    try {
      await context.env.DB.prepare(
        "INSERT INTO board (id, revision, data, updated_at) VALUES (1, 1, ?, ?)",
      ).bind(data, now).run();
      return json(200, { revision: 1, requestId: context.requestId }, context.requestId);
    } catch (error) {
      const current = await getLegacyBoard(context.env.DB);
      if (current) return boardConflict(current, context.requestId);
      throw error;
    }
  }
  const nextRevision = row.revision + 1;
  const result = await context.env.DB.prepare(
    "UPDATE board SET revision = ?, data = ?, updated_at = ? WHERE id = 1 AND revision = ?",
  ).bind(nextRevision, data, now, payload.baseRevision).run();
  if (!result.meta.changes) {
    const current = await getLegacyBoard(context.env.DB);
    return current
      ? boardConflict(current, context.requestId)
      : json(409, {
        revision: 0,
        board: null,
        requestId: context.requestId,
      }, context.requestId);
  }
  return json(200, { revision: nextRevision, requestId: context.requestId }, context.requestId);
}

async function handleLegacyAlias(context: ApiContext): Promise<Response | null> {
  if (new URL(context.request.url).pathname !== "/board") return null;
  const state = await getMigrationState(context.env.DB);
  if (state.status !== "complete") {
    if (context.request.method === "GET") {
      const row = await getLegacyBoard(context.env.DB);
      return row
        ? json(200, {
          revision: row.revision,
          board: JSON.parse(row.data) as unknown,
          requestId: context.requestId,
        }, context.requestId)
        : json(404, { error: "empty", requestId: context.requestId }, context.requestId);
    }
    if (context.request.method !== "PUT") return null;
    if (state.status === "locked") throw new RequestError(503, "migration_locked");
    return putLegacyRow(context);
  }
  const projectId = parseUuid(state.legacy_project_id, "project_id");
  const boardId = parseUuid(state.legacy_board_id, "board_id");
  if (context.request.method === "GET") {
    await authorizeProject(context.env.DB, context.user.id, projectId, "read");
    const row = await getBoard(context.env.DB, projectId, boardId);
    return json(200, {
      revision: row.revision,
      board: JSON.parse(row.data) as unknown,
      requestId: context.requestId,
    }, context.requestId);
  }
  if (context.request.method === "PUT") {
    return putBoardContent(context, projectId, boardId);
  }
  return null;
}

export async function handleBoardRequest(context: ApiContext): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (url.pathname === "/board") return handleLegacyAlias(context);
  const collection = url.pathname.match(/^\/projects\/([0-9a-f-]+)\/boards$/i);
  if (collection) {
    await requireMigrationComplete(context.env.DB);
    const projectId = parseUuid(collection[1], "project_id");
    if (context.request.method === "GET") return listBoards(context, projectId);
    if (context.request.method === "POST") return createBoard(context, projectId);
    return null;
  }
  const item = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/boards\/([0-9a-f-]+)(?:\/(content|archive|restore))?$/i,
  );
  if (!item) return null;
  await requireMigrationComplete(context.env.DB);
  const projectId = parseUuid(item[1], "project_id");
  const boardId = parseUuid(item[2], "board_id");
  if (!item[3] && context.request.method === "GET") {
    return getBoardDetail(context, projectId, boardId);
  }
  if (!item[3] && context.request.method === "PATCH") {
    return renameBoard(context, projectId, boardId);
  }
  if (item[3] === "content" && context.request.method === "PUT") {
    return putBoardContent(context, projectId, boardId);
  }
  if (
    (item[3] === "archive" || item[3] === "restore") &&
    context.request.method === "POST"
  ) {
    return changeBoardStatus(context, projectId, boardId, item[3]);
  }
  return null;
}
