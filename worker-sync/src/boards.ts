import { prepareAuditEvent } from "./audit";
import { authorizeProject, type ProjectAccess } from "./authorization";
import { requireBoardVisible, resolveVisibleBoardIds } from "./board-access";
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
const MAX_WORKFLOW_COLUMNS = 20;
const MAX_COLUMN_TITLE_LENGTH = 40;
const DONE_COLUMN_ID = "done";
const SERVICE_CLASSES = new Set(["standard", "expedite", "fixedDate", "intangible"]);
const MAX_BLOCKED_MS = 100 * 365 * 24 * 3600 * 1000;

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

function isValidTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/** v6 舊 client 相容：欄位缺席即通過，出現才驗格式。 */
function requireValidFlowFields(value: unknown): void {
  const board = asRecord(value);
  if (board && board.settings !== undefined && asRecord(board.settings) === null) {
    throw new RequestError(400, "invalid_settings");
  }
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return;
  for (const raw of Object.values(cards)) {
    const card = asRecord(raw);
    if (!card) continue;
    if (card.serviceClass !== undefined && !SERVICE_CLASSES.has(card.serviceClass as string)) {
      throw new RequestError(400, "invalid_flow_fields");
    }
    if (card.columnEnteredAt !== undefined && !isValidTimestamp(card.columnEnteredAt)) {
      throw new RequestError(400, "invalid_flow_fields");
    }
    if (
      card.startedAt !== undefined && card.startedAt !== null &&
      !isValidTimestamp(card.startedAt)
    ) {
      throw new RequestError(400, "invalid_flow_fields");
    }
    if (card.blockedMs !== undefined) {
      const blockedMs = card.blockedMs;
      if (
        typeof blockedMs !== "number" || !Number.isFinite(blockedMs) ||
        blockedMs < 0 || blockedMs > MAX_BLOCKED_MS
      ) {
        throw new RequestError(400, "invalid_flow_fields");
      }
    }
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** v7 舊 client 相容：`assignmentWindows` 缺席即通過，出現才驗格式。
 *  絕不能要求「每位指派人都要有 window」——那會讓舊卡的任何編輯都 400。 */
function requireValidAssignmentWindows(value: unknown): void {
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return;
  for (const raw of Object.values(cards)) {
    const card = asRecord(raw);
    if (!card || card.assignmentWindows === undefined) continue;
    const windows = card.assignmentWindows;
    if (!Array.isArray(windows) || windows.length > MAX_ASSIGNEES_PER_CARD) {
      throw new RequestError(400, "invalid_assignment_windows");
    }
    const assigned = new Set(
      Array.isArray(card.assigneeUserIds)
        ? card.assigneeUserIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    const seen = new Set<string>();
    for (const entry of windows) {
      const window = asRecord(entry);
      if (!window) throw new RequestError(400, "invalid_assignment_windows");
      const userId = typeof window.userId === "string" ? window.userId : "";
      const startDate = window.startDate;
      const endDate = window.endDate;
      if (
        !userId ||
        !assigned.has(userId) ||
        seen.has(userId) ||
        typeof startDate !== "string" || !DATE_ONLY.test(startDate) ||
        typeof endDate !== "string" || !DATE_ONLY.test(endDate) ||
        endDate < startDate
      ) {
        throw new RequestError(400, "invalid_assignment_windows");
      }
      seen.add(userId);
    }
  }
}

/** 卡片層級上限，與 app/board-model.ts 的 MAX_CARD_DEPTH 一致。 */
const MAX_CARD_DEPTH = 3;

/** v8 舊 client 相容：`parentCardId` 缺席即通過，出現才驗格式。
 *  絕不能把缺席當成違規——現存所有 board 的卡片都沒有這個鍵，那會讓舊看板的任何編輯都 400。
 *  語意與 app/board-model.ts 的 normalizeCardHierarchy 一致（缺父卡／自我指向／環／超深皆非法），
 *  但行為不同：client 端靜默清掉壞連結，這裡發現就直接 400，交由送出方修正。 */
function requireValidCardHierarchy(value: unknown): void {
  const cards = asRecord(asRecord(value)?.cards);
  if (!cards) return;

  const parents = new Map<string, string>();
  for (const [cardId, raw] of Object.entries(cards)) {
    const card = asRecord(raw);
    if (!card || card.parentCardId === undefined || card.parentCardId === null) continue;
    const parentCardId = card.parentCardId;
    if (
      typeof parentCardId !== "string" ||
      !parentCardId ||
      parentCardId === cardId ||
      !Object.hasOwn(cards, parentCardId)
    ) {
      throw new RequestError(400, "invalid_card_hierarchy");
    }
    parents.set(cardId, parentCardId);
  }

  for (const cardId of parents.keys()) {
    const seen = new Set<string>([cardId]);
    let depth = 1;
    let current: string | undefined = parents.get(cardId);
    while (current !== undefined) {
      if (seen.has(current)) throw new RequestError(400, "invalid_card_hierarchy");
      seen.add(current);
      depth += 1;
      if (depth > MAX_CARD_DEPTH) throw new RequestError(400, "invalid_card_hierarchy");
      current = parents.get(current);
    }
  }
}

/** 與 app/board-model.ts 的 DEFAULT_BOARD_SETTINGS 保持一致：無 settings 鍵的舊 board（功能上線前建立）
 * 在 v7 client 一律會被 normalizeBoard 補上這組預設值，故視為「缺席 = 預設值」，
 * 否則 member 對這類舊 board 的任何編輯都會被誤判為「變更了 settings」而 403。 */
const DEFAULT_BOARD_SETTINGS_SIGNATURE = JSON.stringify({
  agingWarnDays: 3,
  agingAlertDays: 7,
  expediteWipLimit: 1,
});

function settingsSignature(value: unknown): string {
  const settings = asRecord(asRecord(value)?.settings);
  if (!settings) return DEFAULT_BOARD_SETTINGS_SIGNATURE;
  return JSON.stringify({
    agingWarnDays: settings.agingWarnDays,
    agingAlertDays: settings.agingAlertDays,
    expediteWipLimit: settings.expediteWipLimit,
  });
}

/** 舊 client 送出的 board 沒有 settings 時，保留前一版設定，避免被剝除。 */
function preserveBoardSettings(previousBoard: unknown, nextBoard: unknown): unknown {
  const next = asRecord(nextBoard);
  const previous = asRecord(previousBoard);
  if (!next || next.settings !== undefined || !previous || previous.settings === undefined) {
    return nextBoard;
  }
  return { ...next, settings: previous.settings };
}

function workflowSignature(value: unknown): string | null {
  const columns = asRecord(value)?.columns;
  if (!Array.isArray(columns)) return null;
  const workflow = columns.map((raw) => {
    const column = asRecord(raw);
    if (!column || typeof column.id !== "string") return null;
    return {
      id: column.id,
      title: typeof column.title === "string" ? column.title : "",
      wipLimit: column.wipLimit === null ? null : Number(column.wipLimit),
    };
  });
  return workflow.some((column) => column === null) ? null : JSON.stringify(workflow);
}

function requireWorkflowManagement(
  access: ProjectAccess,
  previousBoard: unknown,
  nextBoard: unknown,
): void {
  if (access.projectRole === "manager") return;
  const previous = workflowSignature(previousBoard);
  const next = workflowSignature(nextBoard);
  if (previous === null || next === null || previous !== next) {
    throw new RequestError(403, "forbidden");
  }
  if (settingsSignature(previousBoard) !== settingsSignature(nextBoard)) {
    throw new RequestError(403, "forbidden");
  }
}

/** 缺席的 assignmentWindows 與空陣列必須算出同一個簽章，否則 v8 client 一律送空陣列、
 *  舊 board 沒有此鍵，member 對舊 board 的任何編輯都會被誤判為「變更了指派」而 403。
 *  這是流動度量 v7 absent-settings lockout 的同型錯誤，不接受第二次。
 *
 *  只對「有指派內容」（assignees 或 windows 非空）的卡建立條目——沒有指派人也
 *  沒有投入期間的卡不進 map。這是必要的：卡片集合本身的增減不是指派動作，
 *  若對每張卡（含空卡）都建條目，member 新增/刪除任何一張卡都會讓 map 的鍵集合
 *  改變、被誤判成「變更了指派」而 403，等於讓 member 無法自由建卡/刪卡——這是
 *  第一版審查抓到的回歸，Task 2 之前 contributor 本來就能自由增刪卡。 */
function assignmentSignaturesByCard(value: unknown): Map<string, string> {
  const cards = asRecord(asRecord(value)?.cards);
  const signatures = new Map<string, string>();
  if (!cards) return signatures;
  for (const [cardId, raw] of Object.entries(cards)) {
    const card = asRecord(raw);
    const assignees = Array.isArray(card?.assigneeUserIds)
      ? [...card!.assigneeUserIds]
        .filter((id): id is string => typeof id === "string")
        .sort()
      : [];
    const windows = Array.isArray(card?.assignmentWindows)
      ? card!.assignmentWindows
        .map((entry) => {
          const window = asRecord(entry);
          return window
            ? [window.userId, window.startDate, window.endDate]
            : null;
        })
        .filter((window): window is unknown[] => window !== null)
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      : [];
    if (!assignees.length && !windows.length) continue;
    signatures.set(cardId, JSON.stringify([assignees, windows]));
  }
  return signatures;
}

function existingCardIds(value: unknown): Set<string> {
  const cards = asRecord(asRecord(value)?.cards);
  return new Set(cards ? Object.keys(cards) : []);
}

/** 只檢查「兩版都存在」的卡片：卡片一旦從 next board 消失（被刪除），就略過
 *  比對，交給看板編輯權限決定——刪卡不是指派動作，使用者已裁決 member 可以
 *  刪除任何卡（含有指派的卡）。必須走前後兩個 map 鍵集合的聯集，只迭代
 *  next map 會漏掉「member 清空既有卡的指派人」這個案例（該卡在 previous
 *  map 有條目、在 next map 沒有條目，但卡片本身還在 next board 裡）。 */
function requireAssignmentManagement(
  access: ProjectAccess,
  previousBoard: unknown,
  nextBoard: unknown,
): void {
  if (access.projectRole === "manager") return;
  const previous = assignmentSignaturesByCard(previousBoard);
  const next = assignmentSignaturesByCard(nextBoard);
  const nextCardIds = existingCardIds(nextBoard);
  const cardIds = new Set([...previous.keys(), ...next.keys()]);
  for (const cardId of cardIds) {
    if (!nextCardIds.has(cardId)) continue;
    if (previous.get(cardId) !== next.get(cardId)) {
      throw new RequestError(403, "forbidden");
    }
  }
}

type WorkflowColumn = {
  id: string;
  title: string;
  wipLimit: number | null;
  cardIds: string[];
};

function parseWorkflowColumns(value: unknown): WorkflowColumn[] | null {
  const rawColumns = asRecord(value)?.columns;
  if (!Array.isArray(rawColumns)) return null;
  const columns: WorkflowColumn[] = [];
  for (const raw of rawColumns) {
    const column = asRecord(raw);
    if (!column || typeof column.id !== "string" || typeof column.title !== "string") {
      return null;
    }
    const wipLimit = column.wipLimit === null ? null : Number(column.wipLimit);
    if (
      !Array.isArray(column.cardIds) ||
      (wipLimit !== null && (!Number.isInteger(wipLimit) || wipLimit < 1 || wipLimit > 99))
    ) {
      return null;
    }
    columns.push({
      id: column.id,
      title: column.title,
      wipLimit,
      cardIds: column.cardIds.filter((cardId): cardId is string => typeof cardId === "string"),
    });
  }
  return columns;
}

function requireSafeWorkflowTransition(previousBoard: unknown, nextBoard: unknown): void {
  if (workflowSignature(previousBoard) === workflowSignature(nextBoard)) return;
  const previousColumns = parseWorkflowColumns(previousBoard);
  const nextColumns = parseWorkflowColumns(nextBoard);
  if (!nextColumns || !nextColumns.length || nextColumns.length > MAX_WORKFLOW_COLUMNS) {
    throw new RequestError(400, "invalid_workflow");
  }

  const ids = new Set<string>();
  const titleKeys = new Set<string>();
  for (const column of nextColumns) {
    const title = column.title.trim();
    const titleKey = title.normalize("NFKC").toLocaleLowerCase("zh-TW");
    if (
      !column.id ||
      column.id.length > 128 ||
      ids.has(column.id) ||
      !title ||
      title !== column.title ||
      title.length > MAX_COLUMN_TITLE_LENGTH ||
      titleKeys.has(titleKey) ||
      (column.id === DONE_COLUMN_ID && column.wipLimit !== null)
    ) {
      throw new RequestError(400, "invalid_workflow");
    }
    ids.add(column.id);
    titleKeys.add(titleKey);
  }

  if (!previousColumns) return;
  const nextIds = new Set(nextColumns.map((column) => column.id));
  for (const column of previousColumns) {
    if (nextIds.has(column.id)) continue;
    if (column.id === DONE_COLUMN_ID) {
      throw new RequestError(400, "invalid_workflow");
    }
    if (column.cardIds.length) {
      throw new RequestError(400, "column_not_empty");
    }
  }
  if (
    previousColumns.some((column) => column.id === DONE_COLUMN_ID) &&
    !nextIds.has(DONE_COLUMN_ID)
  ) {
    throw new RequestError(400, "invalid_workflow");
  }
  if (
    previousColumns.some((column) => column.id === DONE_COLUMN_ID) &&
    nextIds.has(DONE_COLUMN_ID) &&
    nextColumns.length < 2
  ) {
    throw new RequestError(400, "invalid_workflow");
  }
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
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
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
  const visible = await resolveVisibleBoardIds(
    context.env.DB,
    projectId,
    context.user.id,
    access,
  );
  const rows = visible
    ? result.results.filter((row) => visible.has(row.id))
    : result.results;
  return json(200, {
    boards: rows.map(boardMetadata),
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
  requireValidFlowFields(body.board);
  requireValidAssignmentWindows(body.board);
  requireValidCardHierarchy(body.board);
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
  // 多看板 v1：專案不再限制只能有一個 active Board（migration 0005 已移除
  // boards_one_active_per_project_unique）；仍以 name 唯一索引避免同專案同名。
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
  const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
  await requireBoardVisible(context.env.DB, projectId, boardId, context.user.id, access);
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
    // 多看板 v1：專案必須保留至少一個 active Board。第二個 AND 子句只在
    // target='archived' 時才生效（restore 的 target='active' 讓 `? != 'archived'`
    // 恆真，等同沒有這個限制）；把「還有別的 active Board」摺進 WHERE，讓兩個並發
    // 封存請求最多只有一個能通過，不會讓 active Board 數量競態到 0（見 code review）。
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE boards
         SET status = ?, updated_at = ?, archived_at = ?, archived_by = ?
         WHERE id = ? AND project_id = ? AND status = ?
           AND EXISTS (
             SELECT 1 FROM projects WHERE id = ? AND status = 'active'
           )
           AND (
             ? != 'archived' OR EXISTS (
               SELECT 1 FROM boards AS other
               WHERE other.project_id = ? AND other.status = 'active' AND other.id != ?
             )
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
        target,
        projectId,
        boardId,
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
      // current.status !== target 且不是 project/board 已變動的其他已知原因時，
      // action === "archive" 只剩一種可能：WHERE 子句的「保留至少一個 active
      // Board」條件失敗（current.status 仍是 "active"，因為只有兩種狀態且已排除
      // 等於 target 的情況）。
      if (action === "archive") {
        throw new RequestError(409, "single_board_required");
      }
      throw new RequestError(409, "board_changed");
    }
  } catch (error) {
    if (isConstraintConflict(error)) {
      // 多看板 v1：status='active' 範圍內唯一還會衝突的索引只剩名稱唯一索引
      // （boards_one_active_per_project_unique 已被 0005 移除），恆為 name_conflict。
      throw new RequestError(409, "name_conflict");
    }
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
  await requireBoardVisible(context.env.DB, projectId, boardId, context.user.id, access);
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
  requireValidFlowFields(payload.board);
  requireValidAssignmentWindows(payload.board);
  requireValidCardHierarchy(payload.board);
  const previousBoard = JSON.parse(row.data) as unknown;
  const effectiveBoard = preserveBoardSettings(previousBoard, payload.board);
  requireWorkflowManagement(access, previousBoard, effectiveBoard);
  requireAssignmentManagement(access, previousBoard, effectiveBoard);
  requireSafeWorkflowTransition(previousBoard, effectiveBoard);
  await requireNewAssigneesAreProjectMembers(
    context.env.DB,
    projectId,
    previousBoard,
    effectiveBoard,
  );
  const project = await getProject(context.env.DB, projectId);
  const nextRevision = row.revision + 1;
  const now = new Date().toISOString();
  const next: BoardRow = {
    ...row,
    revision: nextRevision,
    data: JSON.stringify(effectiveBoard),
    updated_at: now,
  };
  const diff = diffBoardStates(previousBoard, effectiveBoard);
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
  requireValidFlowFields(payload.board);
  requireValidAssignmentWindows(payload.board);
  requireValidCardHierarchy(payload.board);
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
    const access = await authorizeProject(context.env.DB, context.user.id, projectId, "read");
    await requireBoardVisible(context.env.DB, projectId, boardId, context.user.id, access);
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
