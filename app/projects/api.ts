import { parsePersistedBoard, type BoardState } from "../board-model";
import { normalizeBaseUrl, type SyncConfig } from "../sync/config";
import {
  isProjectRole,
  isResourceStatus,
  isServerResourceId,
  isUuid,
  isWorkspaceRole,
  parseBoardMeta,
  parseProject,
  parseProjectList,
} from "./model";
import type {
  AdminProjectSummary,
  AdminUserProjectMembership,
  AdminUserSummary,
  ActivityLogEntry,
  BoardContext,
  BoardMeta,
  Project,
  ProjectRole,
  ProjectSummary,
  ResourceStatus,
} from "./types";

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "resource_archived"
  | "invalid_response"
  | "server_error";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly kind: ApiErrorKind,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type ProjectDetail = {
  project: Project;
  myRole: ProjectRole;
};

export type CreatedProject = {
  project: Project;
  board: BoardMeta;
  myRole: ProjectRole | null;
};

export type ProjectMember = {
  userId: string;
  displayName: string;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMemberCandidate = {
  userId: string;
  displayName: string;
  email: string | null;
  currentRole: ProjectRole | null;
};

export type SummaryStats = {
  total: number;
  active: number;
  completed: number;
  overdue: number;
};

export type ProjectReport = {
  includeArchived: boolean;
  boardCount: number;
  stats: SummaryStats;
  monthlyCompletions: Array<{
    month: string;
    monthLabel: string;
    count: number;
  }>;
  boards: Array<{
    id: string;
    name: string;
    status: ResourceStatus;
    revision: number;
    stats: SummaryStats;
  }>;
  generatedAt: string;
  timeZone: string;
};

export type ActivityLogPage = {
  logs: ActivityLogEntry[];
  nextCursor: string | null;
};

export type BoardDetail = {
  meta: BoardMeta;
  content: {
    revision: number;
    board: BoardState;
  };
};

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseStats(value: unknown): SummaryStats | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !nonNegativeInteger(raw.total) ||
    !nonNegativeInteger(raw.active) ||
    !nonNegativeInteger(raw.completed) ||
    !nonNegativeInteger(raw.overdue)
  ) {
    return null;
  }
  return {
    total: raw.total,
    active: raw.active,
    completed: raw.completed,
    overdue: raw.overdue,
  };
}

function invalidResponse(operation: string): ApiClientError {
  return new ApiClientError(
    502,
    "invalid_response",
    "invalid_response",
    `${operation} 回應格式不正確，已停止處理以保護本機資料。`,
  );
}

export function apiPath(...segments: string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export function apiUrl(config: Pick<SyncConfig, "baseUrl">, path: string): string {
  return `${normalizeBaseUrl(config.baseUrl)}${path}`;
}

export async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function errorMessage(kind: ApiErrorKind, operation: string): string {
  if (kind === "unauthorized") return "登入已失效，請重新登入。";
  if (kind === "forbidden") return "目前帳號沒有執行此操作的權限。";
  if (kind === "not_found") return "找不到資源，或目前帳號未參與此專案。";
  if (kind === "resource_archived") return "此專案或看板已封存，現在只能讀取。";
  if (kind === "conflict") return "資料已被其他操作更新，請重新整理後再試。";
  return `${operation} 失敗，請稍後再試。`;
}

export function apiErrorFromResponse(
  response: Response,
  body: unknown,
  operation: string,
): ApiClientError {
  const raw = asRecord(body);
  const code = typeof raw?.error === "string" ? raw.error : `http_${response.status}`;
  let kind: ApiErrorKind = "server_error";
  if (response.status === 401) kind = "unauthorized";
  else if (response.status === 403) kind = "forbidden";
  else if (response.status === 404) kind = "not_found";
  else if (response.status === 409 && code === "resource_archived") {
    kind = "resource_archived";
  } else if (response.status === 409) {
    kind = "conflict";
  }
  return new ApiClientError(response.status, kind, code, errorMessage(kind, operation));
}

export async function requestJson(
  config: SyncConfig,
  path: string,
  operation: string,
  init: RequestInit = {},
  fetcher: FetchLike = fetch,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetcher(apiUrl(config, path), { ...init, headers });
  const body = await readResponseJson(response);
  if (!response.ok) throw apiErrorFromResponse(response, body, operation);
  return body;
}

function assertResourceId(value: string, field: string): void {
  if (!isServerResourceId(value)) {
    throw new ApiClientError(400, "server_error", `invalid_${field}`, `${field} 格式不正確。`);
  }
}

function assertBoardContext(context: BoardContext): void {
  assertResourceId(context.workspaceId, "workspace_id");
  assertResourceId(context.projectId, "project_id");
  assertResourceId(context.boardId, "board_id");
}

function parseProjectDetail(value: unknown, operation: string): ProjectDetail {
  const raw = asRecord(value);
  const projectRaw = asRecord(raw?.project);
  const project = parseProject(projectRaw);
  if (!project || !isProjectRole(projectRaw?.myRole)) throw invalidResponse(operation);
  return { project, myRole: projectRaw.myRole };
}

function parseProjectListResponse(value: unknown): ProjectSummary[] {
  const raw = asRecord(value);
  if (!raw || !Array.isArray(raw.projects)) throw invalidResponse("讀取專案列表");
  const projects = parseProjectList(raw.projects);
  if (projects.length !== raw.projects.length) throw invalidResponse("讀取專案列表");
  return projects;
}

function parseAdminProject(value: unknown): AdminProjectSummary | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !isUuid(raw.id) ||
    !isUuid(raw.workspaceId) ||
    !nonEmptyString(raw.name) ||
    !isResourceStatus(raw.status) ||
    !Array.isArray(raw.ownerIds) ||
    !raw.ownerIds.every(isUuid) ||
    (raw.boardId !== null && !isUuid(raw.boardId)) ||
    (raw.boardName !== null && !nonEmptyString(raw.boardName)) ||
    !nonEmptyString(raw.createdAt) ||
    !nonEmptyString(raw.updatedAt)
  ) {
    return null;
  }
  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    name: raw.name,
    status: raw.status,
    ownerIds: raw.ownerIds,
    boardId: raw.boardId,
    boardName: raw.boardName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function parseCreatedProject(value: unknown): CreatedProject {
  const raw = asRecord(value);
  const projectRaw = asRecord(raw?.project);
  const project = parseProject(projectRaw);
  const board = parseBoardMeta(raw?.board);
  const myRole = raw?.myRole;
  if (
    !project ||
    !board ||
    board.projectId !== project.id ||
    (myRole !== null && !isProjectRole(myRole))
  ) {
    throw invalidResponse("建立專案");
  }
  return { project, board, myRole };
}

function parseAdminProjectListResponse(value: unknown): AdminProjectSummary[] {
  const raw = asRecord(value);
  if (!raw || !Array.isArray(raw.projects)) throw invalidResponse("讀取平台專案列表");
  const projects = raw.projects.map(parseAdminProject);
  if (projects.some((project) => project === null)) {
    throw invalidResponse("讀取平台專案列表");
  }
  return projects as AdminProjectSummary[];
}

function parseAdminUser(value: unknown): AdminUserSummary | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !isUuid(raw.id) ||
    !nonEmptyString(raw.displayName) ||
    (raw.email !== null && !nonEmptyString(raw.email)) ||
    (raw.status !== "active" && raw.status !== "disabled") ||
    !isUuid(raw.workspaceId) ||
    !isWorkspaceRole(raw.workspaceRole) ||
    typeof raw.hasPassword !== "boolean" ||
    !nonNegativeInteger(raw.projectCount) ||
    (raw.lastLoginAt !== null && !nonEmptyString(raw.lastLoginAt)) ||
    !nonEmptyString(raw.createdAt) ||
    !nonEmptyString(raw.updatedAt)
  ) {
    return null;
  }
  return {
    id: raw.id,
    displayName: raw.displayName,
    email: raw.email,
    status: raw.status,
    workspaceId: raw.workspaceId,
    workspaceRole: raw.workspaceRole,
    hasPassword: raw.hasPassword,
    projectCount: raw.projectCount,
    lastLoginAt: raw.lastLoginAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function parseAdminUserListResponse(value: unknown): AdminUserSummary[] {
  const raw = asRecord(value);
  if (!raw || !Array.isArray(raw.users)) throw invalidResponse("讀取平台使用者列表");
  const users = raw.users.map(parseAdminUser);
  if (users.some((user) => user === null)) throw invalidResponse("讀取平台使用者列表");
  return users as AdminUserSummary[];
}

function parseAdminUserProjectMembership(
  value: unknown,
): AdminUserProjectMembership | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const projectId = typeof raw.projectId === "string" ? raw.projectId : "";
  const projectName = typeof raw.projectName === "string" ? raw.projectName : "";
  const { role, status } = raw;
  if (!projectId || !projectName) return null;
  if (!isProjectRole(role)) return null;
  if (!isResourceStatus(status)) return null;
  return { projectId, projectName, role, status };
}

function parseMember(value: unknown): ProjectMember | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !isUuid(raw.userId) ||
    !nonEmptyString(raw.displayName) ||
    !isProjectRole(raw.role) ||
    !nonEmptyString(raw.createdAt) ||
    !nonEmptyString(raw.updatedAt)
  ) {
    return null;
  }
  return {
    userId: raw.userId,
    displayName: raw.displayName,
    role: raw.role,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function parseMemberCandidate(value: unknown): ProjectMemberCandidate | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !isUuid(raw.userId) ||
    !nonEmptyString(raw.displayName) ||
    (raw.email !== null && !nonEmptyString(raw.email)) ||
    (raw.currentRole !== null && !isProjectRole(raw.currentRole))
  ) {
    return null;
  }
  return {
    userId: raw.userId,
    displayName: raw.displayName,
    email: raw.email,
    currentRole: raw.currentRole,
  };
}

function parseBoardListResponse(value: unknown): BoardMeta[] {
  const raw = asRecord(value);
  if (!raw || !Array.isArray(raw.boards)) throw invalidResponse("讀取看板列表");
  const boards = raw.boards.map(parseBoardMeta);
  if (boards.some((board) => board === null)) throw invalidResponse("讀取看板列表");
  return boards as BoardMeta[];
}

function parseStrictBoard(value: unknown, operation: string): BoardState {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidResponse(operation);
  }
  const parsed = parsePersistedBoard(serialized);
  if (parsed.recovered) throw invalidResponse(operation);
  return parsed.board;
}

export function parseBoardDetailResponse(
  value: unknown,
  context: BoardContext,
): BoardDetail {
  const raw = asRecord(value);
  const boardRaw = asRecord(raw?.board);
  const meta = parseBoardMeta(boardRaw);
  const content = asRecord(boardRaw?.content);
  if (
    !meta ||
    meta.projectId !== context.projectId ||
    meta.id !== context.boardId ||
    !content ||
    !nonNegativeInteger(content.revision) ||
    content.revision !== meta.revision
  ) {
    throw invalidResponse("讀取看板");
  }
  return {
    meta,
    content: {
      revision: content.revision,
      board: parseStrictBoard(content.board, "讀取看板"),
    },
  };
}

function parseProjectReport(value: unknown, projectId: string): ProjectReport {
  const raw = asRecord(value);
  const summary = asRecord(raw?.summary);
  const stats = parseStats(summary?.stats);
  if (
    !raw ||
    raw.projectId !== projectId ||
    !summary ||
    typeof summary.includeArchived !== "boolean" ||
    !nonNegativeInteger(summary.boardCount) ||
    !stats ||
    !Array.isArray(summary.monthlyCompletions) ||
    !Array.isArray(summary.boards) ||
    !nonEmptyString(summary.generatedAt) ||
    !nonEmptyString(summary.timeZone)
  ) {
    throw invalidResponse("讀取專案摘要");
  }
  const monthlyCompletions = summary.monthlyCompletions.flatMap((value) => {
    const item = asRecord(value);
    return item &&
      typeof item.month === "string" &&
      /^\d{4}-\d{2}$/.test(item.month) &&
      nonEmptyString(item.monthLabel) &&
      nonNegativeInteger(item.count)
      ? [{ month: item.month, monthLabel: item.monthLabel, count: item.count }]
      : [];
  });
  const boards = summary.boards.flatMap((value) => {
    const item = asRecord(value);
    const boardStats = parseStats(item?.stats);
    return item &&
      isUuid(item.id) &&
      nonEmptyString(item.name) &&
      isResourceStatus(item.status) &&
      nonNegativeInteger(item.revision) &&
      boardStats
      ? [{
        id: item.id,
        name: item.name,
        status: item.status,
        revision: item.revision,
        stats: boardStats,
      }]
      : [];
  });
  if (
    monthlyCompletions.length !== summary.monthlyCompletions.length ||
    boards.length !== summary.boards.length ||
    boards.length !== summary.boardCount
  ) {
    throw invalidResponse("讀取專案摘要");
  }
  return {
    includeArchived: summary.includeArchived,
    boardCount: summary.boardCount,
    stats,
    monthlyCompletions,
    boards,
    generatedAt: summary.generatedAt,
    timeZone: summary.timeZone,
  };
}

function parseActivityLog(value: unknown): ActivityLogEntry | null {
  const raw = asRecord(value);
  const metadata = asRecord(raw?.metadata);
  if (
    !raw ||
    !isUuid(raw.id) ||
    !isUuid(raw.workspaceId) ||
    !isUuid(raw.projectId) ||
    (raw.boardId !== null && !isUuid(raw.boardId)) ||
    !isUuid(raw.actorUserId) ||
    !nonEmptyString(raw.action) ||
    (
      raw.entityType !== "project" &&
      raw.entityType !== "membership" &&
      raw.entityType !== "board" &&
      raw.entityType !== "card" &&
      raw.entityType !== "attachment"
    ) ||
    !nonEmptyString(raw.entityId) ||
    (raw.revision !== null && !nonNegativeInteger(raw.revision)) ||
    !metadata ||
    !nonEmptyString(raw.occurredAt)
  ) {
    return null;
  }
  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    projectId: raw.projectId,
    boardId: raw.boardId,
    actorUserId: raw.actorUserId,
    action: raw.action,
    entityType: raw.entityType,
    entityId: raw.entityId,
    revision: raw.revision,
    metadata,
    occurredAt: raw.occurredAt,
  };
}

function parseLogPage(value: unknown, projectId: string, boardId?: string): ActivityLogPage {
  const raw = asRecord(value);
  if (
    !raw ||
    !Array.isArray(raw.logs) ||
    (raw.nextCursor !== null && typeof raw.nextCursor !== "string")
  ) {
    throw invalidResponse("讀取活動紀錄");
  }
  const logs = raw.logs.map(parseActivityLog);
  if (
    logs.some((log) => log === null) ||
    logs.some((log) =>
      log?.projectId !== projectId || (boardId !== undefined && log.boardId !== boardId)
    )
  ) {
    throw invalidResponse("讀取活動紀錄");
  }
  return { logs: logs as ActivityLogEntry[], nextCursor: raw.nextCursor };
}

export async function listProjects(
  config: SyncConfig,
  status: ResourceStatus = "active",
): Promise<ProjectSummary[]> {
  const query = new URLSearchParams({ status });
  return parseProjectListResponse(
    await requestJson(config, `/projects?${query}`, "讀取專案列表"),
  );
}

export async function listAdminProjects(
  config: SyncConfig,
): Promise<AdminProjectSummary[]> {
  return parseAdminProjectListResponse(
    await requestJson(config, "/admin/projects", "讀取平台專案列表"),
  );
}

export async function listAdminUsers(
  config: SyncConfig,
  workspaceId: string,
): Promise<AdminUserSummary[]> {
  assertResourceId(workspaceId, "workspace_id");
  const query = new URLSearchParams({ workspaceId });
  return parseAdminUserListResponse(
    await requestJson(config, `/admin/users?${query}`, "讀取平台使用者列表"),
  );
}

export async function createAdminUser(
  config: SyncConfig,
  input: {
    workspaceId: string;
    displayName: string;
    email: string;
    password: string;
    workspaceRole: "admin" | "member";
  },
): Promise<AdminUserSummary> {
  assertResourceId(input.workspaceId, "workspace_id");
  const raw = asRecord(await requestJson(config, "/admin/users", "建立使用者", {
    method: "POST",
    body: JSON.stringify(input),
  }));
  const user = parseAdminUser(raw?.user);
  if (!user) throw invalidResponse("建立使用者");
  return user;
}

export async function updateAdminUser(
  config: SyncConfig,
  workspaceId: string,
  userId: string,
  input: {
    displayName?: string;
    email?: string;
    status?: "active" | "disabled";
    workspaceRole?: "admin" | "member";
  },
): Promise<void> {
  assertResourceId(workspaceId, "workspace_id");
  assertResourceId(userId, "user_id");
  const query = new URLSearchParams({ workspaceId });
  await requestJson(
    config,
    `${apiPath("admin", "users", userId)}?${query}`,
    "更新使用者",
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function resetAdminUserPassword(
  config: SyncConfig,
  workspaceId: string,
  userId: string,
  password: string,
): Promise<void> {
  assertResourceId(workspaceId, "workspace_id");
  assertResourceId(userId, "user_id");
  const query = new URLSearchParams({ workspaceId });
  await requestJson(
    config,
    `${apiPath("admin", "users", userId, "password")}?${query}`,
    "重設使用者密碼",
    { method: "POST", body: JSON.stringify({ password }) },
  );
}

export async function listAdminUserProjects(
  config: SyncConfig,
  workspaceId: string,
  userId: string,
): Promise<AdminUserProjectMembership[]> {
  assertResourceId(workspaceId, "workspace_id");
  assertResourceId(userId, "user_id");
  const query = new URLSearchParams({ workspaceId });
  const raw = asRecord(await requestJson(
    config,
    `${apiPath("admin", "users", userId, "projects")}?${query}`,
    "讀取使用者參與的專案",
  ));
  const list = raw?.memberships;
  if (!Array.isArray(list)) throw invalidResponse("讀取使用者參與的專案");
  const memberships = list.map(parseAdminUserProjectMembership);
  if (memberships.some((entry) => entry === null)) {
    throw invalidResponse("讀取使用者參與的專案");
  }
  return memberships as AdminUserProjectMembership[];
}

async function changeAdminProjectStatus(
  config: SyncConfig,
  projectId: string,
  action: "archive" | "restore",
): Promise<void> {
  assertResourceId(projectId, "project_id");
  await requestJson(
    config,
    apiPath("admin", "projects", projectId, action),
    action === "archive" ? "由平台封存專案" : "由平台還原專案",
    { method: "POST" },
  );
}

export const archiveAdminProject = (config: SyncConfig, projectId: string) =>
  changeAdminProjectStatus(config, projectId, "archive");

export const restoreAdminProject = (config: SyncConfig, projectId: string) =>
  changeAdminProjectStatus(config, projectId, "restore");

export async function getProject(
  config: SyncConfig,
  projectId: string,
): Promise<ProjectDetail> {
  assertResourceId(projectId, "project_id");
  return parseProjectDetail(
    await requestJson(config, apiPath("projects", projectId), "讀取專案"),
    "讀取專案",
  );
}

export async function createProject(
  config: SyncConfig,
  input: {
    id: string;
    workspaceId: string;
    name: string;
    boardId: string;
    boardName: string;
    board: BoardState;
    ownerUserId: string;
  },
): Promise<CreatedProject> {
  assertResourceId(input.id, "project_id");
  assertResourceId(input.workspaceId, "workspace_id");
  assertResourceId(input.boardId, "board_id");
  assertResourceId(input.ownerUserId, "owner_user_id");
  return parseCreatedProject(
    await requestJson(config, "/projects", "建立專案與看板", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function renameProject(
  config: SyncConfig,
  projectId: string,
  name: string,
): Promise<ProjectDetail> {
  assertResourceId(projectId, "project_id");
  return parseProjectDetail(
    await requestJson(config, apiPath("projects", projectId), "重新命名專案", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
    "重新命名專案",
  );
}

async function changeProjectStatus(
  config: SyncConfig,
  projectId: string,
  action: "archive" | "restore",
): Promise<ProjectDetail> {
  assertResourceId(projectId, "project_id");
  return parseProjectDetail(
    await requestJson(
      config,
      apiPath("projects", projectId, action),
      action === "archive" ? "封存專案" : "還原專案",
      { method: "POST" },
    ),
    action === "archive" ? "封存專案" : "還原專案",
  );
}

export const archiveProject = (config: SyncConfig, projectId: string) =>
  changeProjectStatus(config, projectId, "archive");

export const restoreProject = (config: SyncConfig, projectId: string) =>
  changeProjectStatus(config, projectId, "restore");

export async function getProjectSummary(
  config: SyncConfig,
  projectId: string,
  includeArchived = false,
): Promise<ProjectReport> {
  assertResourceId(projectId, "project_id");
  const query = new URLSearchParams({ includeArchived: String(includeArchived) });
  return parseProjectReport(
    await requestJson(
      config,
      `${apiPath("projects", projectId, "summary")}?${query}`,
      "讀取專案摘要",
    ),
    projectId,
  );
}

export async function listProjectMembers(
  config: SyncConfig,
  projectId: string,
): Promise<ProjectMember[]> {
  assertResourceId(projectId, "project_id");
  const value = asRecord(
    await requestJson(config, apiPath("projects", projectId, "members"), "讀取專案成員"),
  );
  if (!value || !Array.isArray(value.members)) throw invalidResponse("讀取專案成員");
  const members = value.members.map(parseMember);
  if (members.some((member) => member === null)) throw invalidResponse("讀取專案成員");
  return members as ProjectMember[];
}

export async function listProjectMemberCandidates(
  config: SyncConfig,
  projectId: string,
): Promise<ProjectMemberCandidate[]> {
  assertResourceId(projectId, "project_id");
  const value = asRecord(await requestJson(
    config,
    apiPath("projects", projectId, "member-candidates"),
    "讀取可加入的使用者",
  ));
  if (!value || !Array.isArray(value.users)) throw invalidResponse("讀取可加入的使用者");
  const users = value.users.map(parseMemberCandidate);
  if (users.some((user) => user === null)) throw invalidResponse("讀取可加入的使用者");
  return users as ProjectMemberCandidate[];
}

export async function setProjectMember(
  config: SyncConfig,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<ProjectMember> {
  assertResourceId(projectId, "project_id");
  assertResourceId(userId, "user_id");
  const value = asRecord(await requestJson(
    config,
    apiPath("projects", projectId, "members", userId),
    "更新專案成員",
    { method: "PUT", body: JSON.stringify({ role }) },
  ));
  const member = parseMember(value?.member);
  if (!member) throw invalidResponse("更新專案成員");
  return member;
}

export async function removeProjectMember(
  config: SyncConfig,
  projectId: string,
  userId: string,
): Promise<void> {
  assertResourceId(projectId, "project_id");
  assertResourceId(userId, "user_id");
  await requestJson(
    config,
    apiPath("projects", projectId, "members", userId),
    "移除專案成員",
    { method: "DELETE" },
  );
}

function parseBoardIdsResponse(value: unknown, operation: string): string[] {
  const raw = (value as { boardIds?: unknown } | null)?.boardIds;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string" || !entry)) {
    throw invalidResponse(operation);
  }
  return raw as string[];
}

export async function listMemberBoards(
  config: SyncConfig,
  projectId: string,
  userId: string,
): Promise<string[]> {
  assertResourceId(projectId, "project_id");
  assertResourceId(userId, "user_id");
  return parseBoardIdsResponse(
    await requestJson(
      config,
      apiPath("projects", projectId, "members", userId, "boards"),
      "讀取成員看板指派",
    ),
    "讀取成員看板指派",
  );
}

export async function putMemberBoards(
  config: SyncConfig,
  projectId: string,
  userId: string,
  boardIds: string[],
): Promise<string[]> {
  assertResourceId(projectId, "project_id");
  assertResourceId(userId, "user_id");
  for (const boardId of boardIds) assertResourceId(boardId, "board_id");
  return parseBoardIdsResponse(
    await requestJson(
      config,
      apiPath("projects", projectId, "members", userId, "boards"),
      "更新成員看板指派",
      { method: "PUT", body: JSON.stringify({ boardIds }) },
    ),
    "更新成員看板指派",
  );
}

export async function listProjectLogs(
  config: SyncConfig,
  projectId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<ActivityLogPage> {
  assertResourceId(projectId, "project_id");
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  const suffix = query.size ? `?${query}` : "";
  return parseLogPage(
    await requestJson(
      config,
      `${apiPath("projects", projectId, "logs")}${suffix}`,
      "讀取活動紀錄",
    ),
    projectId,
  );
}

export async function listBoards(
  config: SyncConfig,
  projectId: string,
  status: ResourceStatus = "active",
): Promise<BoardMeta[]> {
  assertResourceId(projectId, "project_id");
  const query = new URLSearchParams({ status });
  return parseBoardListResponse(
    await requestJson(
      config,
      `${apiPath("projects", projectId, "boards")}?${query}`,
      "讀取看板列表",
    ),
  );
}

export async function createBoard(
  config: SyncConfig,
  input: { context: Omit<BoardContext, "boardId">; boardId: string; name: string; board: BoardState },
): Promise<BoardDetail> {
  assertResourceId(input.context.workspaceId, "workspace_id");
  assertResourceId(input.context.projectId, "project_id");
  assertResourceId(input.boardId, "board_id");
  const context = { ...input.context, boardId: input.boardId };
  const value = await requestJson(
    config,
    apiPath("projects", context.projectId, "boards"),
    "建立看板",
    {
      method: "POST",
      body: JSON.stringify({ id: input.boardId, name: input.name, board: input.board }),
    },
  );
  return parseBoardDetailResponse(value, context);
}

export async function getBoard(
  config: SyncConfig,
  context: BoardContext,
): Promise<BoardDetail> {
  assertBoardContext(context);
  return parseBoardDetailResponse(
    await requestJson(
      config,
      apiPath("projects", context.projectId, "boards", context.boardId),
      "讀取看板",
    ),
    context,
  );
}

export async function renameBoard(
  config: SyncConfig,
  context: BoardContext,
  name: string,
): Promise<BoardMeta> {
  assertBoardContext(context);
  const value = asRecord(await requestJson(
    config,
    apiPath("projects", context.projectId, "boards", context.boardId),
    "重新命名看板",
    { method: "PATCH", body: JSON.stringify({ name }) },
  ));
  const board = parseBoardMeta(value?.board);
  if (!board || board.id !== context.boardId || board.projectId !== context.projectId) {
    throw invalidResponse("重新命名看板");
  }
  return board;
}

async function changeBoardStatus(
  config: SyncConfig,
  context: BoardContext,
  action: "archive" | "restore",
): Promise<BoardMeta> {
  assertBoardContext(context);
  const value = asRecord(await requestJson(
    config,
    apiPath("projects", context.projectId, "boards", context.boardId, action),
    action === "archive" ? "封存看板" : "還原看板",
    { method: "POST" },
  ));
  const board = parseBoardMeta(value?.board);
  if (!board || board.id !== context.boardId || board.projectId !== context.projectId) {
    throw invalidResponse(action === "archive" ? "封存看板" : "還原看板");
  }
  return board;
}

export const archiveBoard = (config: SyncConfig, context: BoardContext) =>
  changeBoardStatus(config, context, "archive");

export const restoreBoard = (config: SyncConfig, context: BoardContext) =>
  changeBoardStatus(config, context, "restore");

export async function listBoardLogs(
  config: SyncConfig,
  context: BoardContext,
  options: { limit?: number; cursor?: string } = {},
): Promise<ActivityLogPage> {
  assertBoardContext(context);
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  const suffix = query.size ? `?${query}` : "";
  return parseLogPage(
    await requestJson(
      config,
      `${apiPath(
        "projects",
        context.projectId,
        "boards",
        context.boardId,
        "logs",
      )}${suffix}`,
      "讀取看板活動紀錄",
    ),
    context.projectId,
    context.boardId,
  );
}
