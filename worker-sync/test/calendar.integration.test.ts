import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resolveCalendarScope } from "../src/calendar";
import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const workspaceA = "70000000-0000-4000-8000-000000000001";
const workspaceB = "70000000-0000-4000-8000-000000000002";

const adminUserId = "71000000-0000-4000-8000-000000000001";
const ownerUserId = "71000000-0000-4000-8000-000000000002";
const memberManagerId = "71000000-0000-4000-8000-000000000003";
const memberContributorId = "71000000-0000-4000-8000-000000000004";
const outsiderId = "71000000-0000-4000-8000-000000000005";
const crossWorkspaceUserId = "71000000-0000-4000-8000-000000000006";
const otherOwnerId = "71000000-0000-4000-8000-000000000007";

const projectActive1 = "72000000-0000-4000-8000-000000000001"; // "Alpha"
const projectActive2 = "72000000-0000-4000-8000-000000000002"; // "Beta"
const projectArchived = "72000000-0000-4000-8000-000000000003"; // "Zeta"（archived）
const projectOwnedByManager = "72000000-0000-4000-8000-000000000004";
const projectContribOnly = "72000000-0000-4000-8000-000000000005";
const projectContributorHome = "72000000-0000-4000-8000-000000000006";
const projectOwnedInA = "72000000-0000-4000-8000-000000000007";
const projectOwnedInB = "72000000-0000-4000-8000-000000000008";
const projectOwnedArchived = "72000000-0000-4000-8000-000000000009"; // memberManagerId 是 manager，但已 archived
const projectInWorkspaceB = "72000000-0000-4000-8000-000000000010"; // workspace B 的 active 專案（admin 洩漏檢查）
const projectViewerHome = "72000000-0000-4000-8000-000000000011";
const projectManagerElsewhere = "72000000-0000-4000-8000-000000000012"; // outsiderId 是 manager，但不是 workspace 成員

// --- Task 2：GET /calendar 專用 fixture（沿用上面的 workspaceA／adminUserId／
// memberManagerId／memberContributorId／outsiderId／otherOwnerId，只新增這裡用到的
// project／board／assignee id，避免與上面 resolveCalendarScope 測試互相牽動）。
const TEST_MONTH = "2026-08";

const calAssigneeId = "73000000-0000-4000-8000-000000000001"; // 出現在回傳卡片上，應現身於 assignees[]
const calOtherAssigneeId = "73000000-0000-4000-8000-000000000002"; // 只出現在範圍外的卡片，不該現身於 assignees[]

const calProjectAlpha = "74000000-0000-4000-8000-000000000001";
const calProjectBeta = "74000000-0000-4000-8000-000000000002";
const calProjectArchived = "74000000-0000-4000-8000-000000000003";
const calProjectManaged = "74000000-0000-4000-8000-000000000004"; // memberManagerId manage 的專案
const calProjectUnowned = "74000000-0000-4000-8000-000000000005"; // active 但 memberManagerId 沒有 own
const calProjectContribHome = "74000000-0000-4000-8000-000000000006";
const calProjectManyBoards = "74000000-0000-4000-8000-000000000007";

const calBoardAlpha = "75000000-0000-4000-8000-000000000001";
const calBoardBeta = "75000000-0000-4000-8000-000000000002";
const calBoardArchived = "75000000-0000-4000-8000-000000000003"; // active 專案裡的 archived 看板
const calBoardInArchivedProject = "75000000-0000-4000-8000-000000000004";
const calBoardManaged = "75000000-0000-4000-8000-000000000005";
const calBoardUnowned = "75000000-0000-4000-8000-000000000006";
const calBoardContribHome = "75000000-0000-4000-8000-000000000007";

/** 由固定注入的月份字串（不依賴「當月」）算出邊界日期，供跨月邊界測試使用。 */
function monthBounds(month: string): { first: string; last: string; prevLast: string; nextFirst: string } {
  const [year, monthNum] = month.split("-").map(Number);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    first: iso(new Date(Date.UTC(year, monthNum - 1, 1))),
    last: iso(new Date(Date.UTC(year, monthNum, 0))),
    prevLast: iso(new Date(Date.UTC(year, monthNum - 1, 0))),
    nextFirst: iso(new Date(Date.UTC(year, monthNum, 1))),
  };
}

function tokenFor(userId: string): string {
  return `calendar-test-token-${userId}`;
}

type CalendarCardBody = {
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

type CalendarResponseBody = {
  month: string;
  scope: "workspace" | "owned_projects";
  scheduled: CalendarCardBody[];
  unscheduled: CalendarCardBody[];
  unscheduledTruncated: boolean;
  boardsTruncated: boolean;
  assignees: Array<{ userId: string; displayName: string }>;
  requestId: string;
};

async function insertUser(id: string) {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  ).bind(id, `User ${id.slice(-1)}`, now, now).run();
}

async function insertWorkspaceMember(workspaceId: string, userId: string, role: string) {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(workspaceId, userId, role, now, now).run();
}

async function insertProject(
  id: string,
  workspaceId: string,
  name: string,
  createdBy: string,
  status: "active" | "archived" = "active",
) {
  const now = "2026-08-12T00:00:00.000Z";
  if (status === "archived") {
    await env.DB.prepare(
      `INSERT INTO projects (
         id, workspace_id, name, normalized_name, status, created_by,
         created_at, updated_at, archived_at, archived_by
       ) VALUES (?, ?, ?, ?, 'archived', ?, ?, ?, ?, ?)`,
    ).bind(id, workspaceId, name, name.toLowerCase(), createdBy, now, now, now, createdBy).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).bind(id, workspaceId, name, name.toLowerCase(), createdBy, now, now).run();
}

async function insertProjectMember(projectId: string, userId: string, role: string) {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO project_members (project_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(projectId, userId, role, now, now).run();
}

/** 幫既有 user_accounts 列補一顆 personal token，讓測試能以該身分呼叫 /calendar。 */
async function insertToken(userId: string) {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'test', ?, 'personal', ?)",
  ).bind(`${userId}-calendar-token`, userId, await sha256Hex(tokenFor(userId)), now).run();
}

async function insertMigrationComplete() {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'complete', ?, ?, ?, ?)`,
  ).bind(
    workspaceA,
    "76000000-0000-4000-8000-000000000000",
    "76000000-0000-4000-8000-000000000001",
    now,
  ).run();
}

type CardOverrides = {
  id: string;
  title?: string;
  dueDate?: string;
  completedAt?: string | null;
  blocked?: boolean;
  serviceClass?: string;
  assigneeUserIds?: string[];
  description?: string;
  blockedReason?: string;
  checklist?: unknown[];
  attachments?: unknown[];
};

/** schema v7 卡片的最小可用形狀（至少含 id/title/dueDate/completedAt/blocked/
 *  serviceClass/assigneeUserIds）；description／checklist／attachments／
 *  blockedReason 只在明確傳入時才附加，用於測試 7 的洩漏斷言。 */
function cardFixture(overrides: CardOverrides): Record<string, unknown> {
  const { id, title, dueDate, completedAt, blocked, serviceClass, assigneeUserIds } = overrides;
  return {
    id,
    title: title ?? `Card ${id}`,
    dueDate: dueDate ?? "",
    completedAt: completedAt ?? null,
    blocked: blocked ?? false,
    serviceClass: serviceClass ?? "standard",
    assigneeUserIds: assigneeUserIds ?? [],
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    ...(overrides.blockedReason !== undefined ? { blockedReason: overrides.blockedReason } : {}),
    ...(overrides.checklist !== undefined ? { checklist: overrides.checklist } : {}),
    ...(overrides.attachments !== undefined ? { attachments: overrides.attachments } : {}),
  };
}

function boardJson(cards: Record<string, unknown>): string {
  return JSON.stringify({
    version: 7,
    columns: [{ id: "todo", title: "Todo", wipLimit: null, cardIds: Object.keys(cards) }],
    cards,
    labels: [{ id: "label-1", name: "General", color: "#888888" }],
    settings: { agingWarnDays: 3, agingAlertDays: 7, expediteWipLimit: 1 },
  });
}

async function insertBoard(
  id: string,
  projectId: string,
  name: string,
  cards: Record<string, unknown>,
  options: { status?: "active" | "archived"; updatedAt?: string } = {},
) {
  const updatedAt = options.updatedAt ?? "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at, archived_at, archived_by
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    id,
    projectId,
    name,
    name.toLowerCase(),
    options.status ?? "active",
    boardJson(cards),
    otherOwnerId,
    updatedAt,
    updatedAt,
  ).run();
}

/** 直接寫入任意（可能不合法）的 boards.data 文字，繞過 boardJson 的
 *  JSON.stringify——用於模擬「既存資料早於任何一版寫入驗證」的畸形資料，這種
 *  形狀不可能透過應用層的寫入路徑產生。 */
async function insertRawBoard(id: string, projectId: string, name: string, rawData: string) {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at, archived_at, archived_by
     ) VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(id, projectId, name, name.toLowerCase(), rawData, otherOwnerId, now, now).run();
}

const endpoint = "https://sync.test";

async function dispatch(token: string | null, path: string): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return exports.default.fetch(new Request(`${endpoint}${path}`, { headers }));
}

beforeAll(async () => {
  const statements = [
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'archived')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('manager', 'contributor', 'viewer')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
    "CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'archived')), revision INTEGER NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    // Task 2：GET /calendar 走完整 HTTP 路徑（authenticate → requireMigrationComplete →
    // resolveCalendarScope），需要這三張表。
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT NOT NULL, legacy_project_id TEXT NOT NULL, legacy_board_id TEXT NOT NULL, locked_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, error TEXT)",
    // 測試意圖 10：member board 指派表——用於證明指派看板不能繞過 /calendar 的
    // workspace/manager 門檻。刻意不宣告 FK（這份手寫 schema 全表皆未啟用外鍵）。
    "CREATE TABLE IF NOT EXISTS project_member_boards (project_id TEXT NOT NULL, user_id TEXT NOT NULL, board_id TEXT NOT NULL, assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id, board_id))",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "project_member_boards", "boards", "project_members", "projects",
    "workspace_members", "workspaces", "access_tokens", "user_accounts", "migration_state",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO workspaces (id, name, created_at, updated_at)
     VALUES (?, 'Workspace A', ?, ?), (?, 'Workspace B', ?, ?)`,
  ).bind(workspaceA, now, now, workspaceB, now, now).run();
  for (const id of [
    adminUserId, ownerUserId, memberManagerId, memberContributorId,
    outsiderId, crossWorkspaceUserId, otherOwnerId,
  ]) {
    await insertUser(id);
  }
});

describe("resolveCalendarScope", () => {
  it("gives a workspace admin every active project, including ones they haven't joined, and excludes archived", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(projectActive1, workspaceA, "Alpha", otherOwnerId);
    await insertProject(projectActive2, workspaceA, "Beta", otherOwnerId);
    await insertProject(projectArchived, workspaceA, "Zeta", otherOwnerId, "archived");
    // adminUserId 刻意不加入任何 project_members——驗證「不是成員的專案」也在範圍內。
    // workspace B 的 active 專案：驗證 admin 查 workspace A 不會連帶洩漏其他 workspace。
    await insertProject(projectInWorkspaceB, workspaceB, "Other Workspace", otherOwnerId);

    const scope = await resolveCalendarScope(env.DB, adminUserId, workspaceA);
    expect(scope).toEqual({ kind: "workspace", projectIds: [projectActive1, projectActive2] });
  });

  it("gives a workspace owner the same workspace-wide scope as admin", async () => {
    await insertWorkspaceMember(workspaceA, ownerUserId, "owner");
    await insertProject(projectActive1, workspaceA, "Alpha", otherOwnerId);
    await insertProject(projectActive2, workspaceA, "Beta", otherOwnerId);
    await insertProject(projectArchived, workspaceA, "Zeta", otherOwnerId, "archived");

    const scope = await resolveCalendarScope(env.DB, ownerUserId, workspaceA);
    expect(scope).toEqual({ kind: "workspace", projectIds: [projectActive1, projectActive2] });
  });

  it("limits a plain member who manages a project to just their own active projects", async () => {
    await insertWorkspaceMember(workspaceA, memberManagerId, "member");
    await insertProject(projectOwnedByManager, workspaceA, "Owned", memberManagerId);
    await insertProjectMember(projectOwnedByManager, memberManagerId, "manager");
    // 只是 contributor 的專案不該算「own」。
    await insertProject(projectContribOnly, workspaceA, "Contrib Only", otherOwnerId);
    await insertProjectMember(projectContribOnly, memberManagerId, "contributor");
    // 別人 manage 的專案也不該出現。
    await insertProject(projectActive1, workspaceA, "Alpha", otherOwnerId);
    await insertProjectMember(projectActive1, otherOwnerId, "manager");
    // 自己 manage 但已 archived 的專案也不該出現——這正是 owned 路徑的 active 篩選。
    await insertProject(projectOwnedArchived, workspaceA, "Owned Archived", memberManagerId, "archived");
    await insertProjectMember(projectOwnedArchived, memberManagerId, "manager");

    const scope = await resolveCalendarScope(env.DB, memberManagerId, workspaceA);
    expect(scope).toEqual({ kind: "owned_projects", projectIds: [projectOwnedByManager] });
  });

  it("rejects a plain member whose project roles are all contributor/viewer with 403 forbidden", async () => {
    await insertWorkspaceMember(workspaceA, memberContributorId, "member");
    await insertProject(projectContributorHome, workspaceA, "Contributor Home", otherOwnerId);
    await insertProjectMember(projectContributorHome, memberContributorId, "contributor");
    // viewer 也不該算「own」——與 contributor 同樣不足以取得 owned_projects。
    await insertProject(projectViewerHome, workspaceA, "Viewer Home", otherOwnerId);
    await insertProjectMember(projectViewerHome, memberContributorId, "viewer");

    await expect(resolveCalendarScope(env.DB, memberContributorId, workspaceA))
      .rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("rejects a non-member of the workspace with 404 not_found, even if they manage a project inside it", async () => {
    // workspace 檢查必須先擋下——project_members 有列也不能洩漏專案存在或放寬成 403。
    await insertProject(projectManagerElsewhere, workspaceA, "Managed By Outsider", outsiderId);
    await insertProjectMember(projectManagerElsewhere, outsiderId, "manager");

    await expect(resolveCalendarScope(env.DB, outsiderId, workspaceA))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("isolates ownership across workspaces: owning a project in B doesn't leak into A's scope", async () => {
    await insertWorkspaceMember(workspaceA, crossWorkspaceUserId, "member");
    await insertWorkspaceMember(workspaceB, crossWorkspaceUserId, "member");
    await insertProject(projectOwnedInA, workspaceA, "Owned In A", crossWorkspaceUserId);
    await insertProjectMember(projectOwnedInA, crossWorkspaceUserId, "manager");
    await insertProject(projectOwnedInB, workspaceB, "Owned In B", crossWorkspaceUserId);
    await insertProjectMember(projectOwnedInB, crossWorkspaceUserId, "manager");

    const scope = await resolveCalendarScope(env.DB, crossWorkspaceUserId, workspaceA);
    expect(scope).toEqual({ kind: "owned_projects", projectIds: [projectOwnedInA] });
  });
});

describe("GET /calendar", () => {
  beforeEach(async () => {
    await insertMigrationComplete();
    for (const id of [adminUserId, memberManagerId, memberContributorId, outsiderId]) {
      await insertToken(id);
    }
  });

  // 測試意圖 1
  it("returns 200 with workspace scope for a workspace admin, including correct project/board names", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertProject(calProjectBeta, workspaceA, "Calendar Beta", otherOwnerId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      "card-alpha-1": cardFixture({ id: "card-alpha-1", title: "Ship the thing", dueDate: `${TEST_MONTH}-14` }),
    });
    await insertBoard(calBoardBeta, calProjectBeta, "Beta Board", {
      "card-beta-1": cardFixture({ id: "card-beta-1", title: "Review the thing", dueDate: `${TEST_MONTH}-20` }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    expect(body.month).toBe(TEST_MONTH);
    expect(body.scope).toBe("workspace");
    expect(body.scheduled).toHaveLength(2);
    expect(body.scheduled).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardId: "card-alpha-1",
        title: "Ship the thing",
        projectId: calProjectAlpha,
        projectName: "Calendar Alpha",
        boardId: calBoardAlpha,
        boardName: "Alpha Board",
      }),
      expect.objectContaining({
        cardId: "card-beta-1",
        title: "Review the thing",
        projectId: calProjectBeta,
        projectName: "Calendar Beta",
        boardId: calBoardBeta,
        boardName: "Beta Board",
      }),
    ]));
  });

  // 測試意圖 2
  it("excludes completed cards from both scheduled and unscheduled", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      "card-open": cardFixture({ id: "card-open", dueDate: `${TEST_MONTH}-14` }),
      "card-done-scheduled": cardFixture({
        id: "card-done-scheduled", dueDate: `${TEST_MONTH}-15`, completedAt: "2026-08-15T00:00:00.000Z",
      }),
      "card-done-unscheduled": cardFixture({
        id: "card-done-unscheduled", dueDate: "", completedAt: "2026-08-16T00:00:00.000Z",
      }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const allIds = [...body.scheduled, ...body.unscheduled].map((card) => card.cardId);
    expect(allIds).toContain("card-open");
    expect(allIds).not.toContain("card-done-scheduled");
    expect(allIds).not.toContain("card-done-unscheduled");
  });

  // 測試意圖 3
  it("excludes cards from an archived project and from an archived board inside an active project", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertProject(calProjectArchived, workspaceA, "Calendar Archived Project", otherOwnerId, "archived");
    await insertBoard(calBoardAlpha, calProjectAlpha, "Active Board", {
      "card-active": cardFixture({ id: "card-active", dueDate: `${TEST_MONTH}-14` }),
    });
    await insertBoard(calBoardArchived, calProjectAlpha, "Archived Board In Active Project", {
      "card-archived-board": cardFixture({ id: "card-archived-board", dueDate: `${TEST_MONTH}-14` }),
    }, { status: "archived" });
    await insertBoard(calBoardInArchivedProject, calProjectArchived, "Board In Archived Project", {
      "card-archived-project": cardFixture({ id: "card-archived-project", dueDate: `${TEST_MONTH}-14` }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const allIds = [...body.scheduled, ...body.unscheduled].map((card) => card.cardId);
    expect(allIds).toContain("card-active");
    expect(allIds).not.toContain("card-archived-board");
    expect(allIds).not.toContain("card-archived-project");
  });

  // 測試意圖 4
  it("includes month-start/month-end days in scheduled, excludes neighboring-month days, and routes empty dueDate to unscheduled", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    const bounds = monthBounds(TEST_MONTH);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      "card-empty": cardFixture({ id: "card-empty", dueDate: "" }),
      "card-first": cardFixture({ id: "card-first", dueDate: bounds.first }),
      "card-last": cardFixture({ id: "card-last", dueDate: bounds.last }),
      "card-prev": cardFixture({ id: "card-prev", dueDate: bounds.prevLast }),
      "card-next": cardFixture({ id: "card-next", dueDate: bounds.nextFirst }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const scheduledIds = body.scheduled.map((card) => card.cardId);
    const unscheduledIds = body.unscheduled.map((card) => card.cardId);

    expect(scheduledIds).toEqual(expect.arrayContaining(["card-first", "card-last"]));
    expect(scheduledIds).not.toContain("card-prev");
    expect(scheduledIds).not.toContain("card-next");
    expect(scheduledIds).not.toContain("card-empty");
    expect(unscheduledIds).toContain("card-empty");
    expect(unscheduledIds).not.toContain("card-prev");
    expect(unscheduledIds).not.toContain("card-next");
  });

  // 測試意圖 5
  it("returns blocked as a real boolean and serviceClass as a string, defaulting a legacy card's missing serviceClass to standard", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    // 刻意不含 serviceClass 欄位：模擬 schema v7 之前建立、從未被改寫過的舊卡。
    const legacyCard = {
      id: "card-legacy", title: "Legacy Card", dueDate: `${TEST_MONTH}-05`,
      completedAt: null, blocked: false, assigneeUserIds: [],
    };
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      "card-blocked": cardFixture({
        id: "card-blocked", dueDate: `${TEST_MONTH}-06`, blocked: true, serviceClass: "expedite",
      }),
      "card-legacy": legacyCard,
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const blockedCard = body.scheduled.find((card) => card.cardId === "card-blocked");
    const legacy = body.scheduled.find((card) => card.cardId === "card-legacy");

    expect(blockedCard).toBeDefined();
    expect(blockedCard?.blocked).toBe(true);
    expect(typeof blockedCard?.blocked).toBe("boolean");
    expect(typeof blockedCard?.serviceClass).toBe("string");
    expect(blockedCard?.serviceClass).toBe("expedite");
    expect(legacy?.serviceClass).toBe("standard");
  });

  // 測試意圖 6
  it("only includes assignees that actually appear on a returned card, with their display name", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertUser(calAssigneeId);
    await insertUser(calOtherAssigneeId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      "card-assigned": cardFixture({
        id: "card-assigned", dueDate: `${TEST_MONTH}-07`, assigneeUserIds: [calAssigneeId],
      }),
      // 下個月的卡：不在 scheduled/unscheduled 裡，其 assignee 也不該現身於 assignees[]。
      "card-out-of-scope": cardFixture({
        id: "card-out-of-scope", dueDate: monthBounds(TEST_MONTH).nextFirst, assigneeUserIds: [calOtherAssigneeId],
      }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    expect(body.assignees).toEqual([
      { userId: calAssigneeId, displayName: `User ${calAssigneeId.slice(-1)}` },
    ]);
  });

  // 測試意圖 7
  it("never leaks description, checklist, attachments, or blockedReason content in the response", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      "card-secret": cardFixture({
        id: "card-secret",
        dueDate: `${TEST_MONTH}-08`,
        description: "SECRET_MARKER_DESCRIPTION_9f3a",
        blockedReason: "SECRET_MARKER_BLOCKEDREASON_9f3a",
        checklist: [{ id: "chk-1", text: "SECRET_MARKER_CHECKLIST_9f3a", done: false }],
        attachments: [{
          id: "att-1", type: "photo", fileName: "SECRET_MARKER_ATTACHMENT_9f3a",
          mimeType: "image/png", size: 10, createdAt: "2026-08-01T00:00:00.000Z",
        }],
      }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("SECRET_MARKER");
  });

  // 測試意圖 8
  it("gives a project-owning plain member owned_projects scope limited to their own projects", async () => {
    await insertWorkspaceMember(workspaceA, memberManagerId, "member");
    await insertProject(calProjectManaged, workspaceA, "Managed Project", memberManagerId);
    await insertProjectMember(calProjectManaged, memberManagerId, "manager");
    await insertProject(calProjectUnowned, workspaceA, "Unowned Project", otherOwnerId);
    await insertBoard(calBoardManaged, calProjectManaged, "Managed Board", {
      "card-managed": cardFixture({ id: "card-managed", dueDate: `${TEST_MONTH}-09` }),
    });
    await insertBoard(calBoardUnowned, calProjectUnowned, "Unowned Board", {
      "card-unowned": cardFixture({ id: "card-unowned", dueDate: `${TEST_MONTH}-09` }),
    });

    const response = await dispatch(tokenFor(memberManagerId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    expect(body.scope).toBe("owned_projects");
    const ids = body.scheduled.map((card) => card.cardId);
    expect(ids).toContain("card-managed");
    expect(ids).not.toContain("card-unowned");
  });

  // 測試意圖 9
  it("rejects a contributor with 403, a workspace non-member with 404, and an unauthenticated caller with 401", async () => {
    await insertWorkspaceMember(workspaceA, memberContributorId, "member");
    await insertProject(calProjectContribHome, workspaceA, "Contributor Home", otherOwnerId);
    await insertProjectMember(calProjectContribHome, memberContributorId, "contributor");

    const contributorResponse = await dispatch(
      tokenFor(memberContributorId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(contributorResponse.status).toBe(403);
    expect(await contributorResponse.json()).toMatchObject({ error: "forbidden" });

    // outsiderId 有合法 token，但沒有 workspaceA 的 workspace_members 列。
    const outsiderResponse = await dispatch(
      tokenFor(outsiderId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(outsiderResponse.status).toBe(404);
    expect(await outsiderResponse.json()).toMatchObject({ error: "not_found" });

    const noTokenResponse = await dispatch(null, `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(noTokenResponse.status).toBe(401);
    expect(await noTokenResponse.json()).toMatchObject({ error: "unauthorized" });
  });

  // 測試意圖 10（本端點最重要的安全斷言）
  it("does not let a contributor bypass the workspace/manager gate via a per-board assignment", async () => {
    await insertWorkspaceMember(workspaceA, memberContributorId, "member");
    await insertProject(calProjectContribHome, workspaceA, "Contributor Home", otherOwnerId);
    await insertProjectMember(calProjectContribHome, memberContributorId, "contributor");
    await insertBoard(calBoardContribHome, calProjectContribHome, "Contributor's Assigned Board", {
      "card-1": cardFixture({ id: "card-1", dueDate: `${TEST_MONTH}-05` }),
    });
    const now = "2026-08-12T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO project_member_boards (project_id, user_id, board_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(calProjectContribHome, memberContributorId, calBoardContribHome, otherOwnerId, now).run();

    const response = await dispatch(
      tokenFor(memberContributorId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
  });

  // 測試意圖 11
  it("validates month and workspaceId query params with 400s", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    const token = tokenFor(adminUserId);

    const invalidMonthQueries = [
      `workspaceId=${workspaceA}&month=2026-13`,
      `workspaceId=${workspaceA}&month=2026-8`,
      `workspaceId=${workspaceA}`, // 缺少 month
    ];
    for (const qs of invalidMonthQueries) {
      const response = await dispatch(token, `/calendar?${qs}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_month" });
    }

    const badWorkspace = await dispatch(token, `/calendar?workspaceId=not-a-uuid&month=${TEST_MONTH}`);
    expect(badWorkspace.status).toBe(400);
    expect(await badWorkspace.json()).toMatchObject({ error: "invalid_workspace_id" });
  });

  // 測試意圖 12
  it("caps expansion at the 50 most-recently-updated boards and reports boardsTruncated accordingly", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectManyBoards, workspaceA, "Many Boards", otherOwnerId);

    const totalBoards = 51;
    for (let i = 0; i < totalBoards; i += 1) {
      const boardId = `board-many-${String(i).padStart(3, "0")}`;
      const updatedAt = `2026-08-01T00:${String(i).padStart(2, "0")}:00.000Z`;
      await insertBoard(boardId, calProjectManyBoards, `Board ${i}`, {
        [`card-many-${i}`]: cardFixture({ id: `card-many-${i}`, dueDate: `${TEST_MONTH}-10` }),
      }, { updatedAt });
    }

    const truncatedResponse = await dispatch(
      tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(truncatedResponse.status).toBe(200);
    const truncatedBody = await truncatedResponse.json() as CalendarResponseBody;
    expect(truncatedBody.boardsTruncated).toBe(true);
    expect(truncatedBody.scheduled).toHaveLength(50);
    expect(new Set(truncatedBody.scheduled.map((card) => card.boardId)).size).toBe(50);

    // 刪掉一個看板，讓 active 看板數從 51 降到 50——等價於「seed 50 個」，不必重建
    // 整組 fixture 即可驗證 boardsTruncated 翻為 false 的臨界點。
    await env.DB.prepare("DELETE FROM boards WHERE id = ?").bind("board-many-000").run();

    const fullResponse = await dispatch(
      tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(fullResponse.status).toBe(200);
    const fullBody = await fullResponse.json() as CalendarResponseBody;
    expect(fullBody.boardsTruncated).toBe(false);
    expect(fullBody.scheduled).toHaveLength(50);
  });

  // 測試意圖 13（本任務最重要的一項）：SQL 篩選條件與「JS 自行過濾同一批 seed 資料」
  // 交叉比對 cardId 集合，防止 SQL WHERE 寫錯卻靜默漏卡或多卡。
  it("matches an independent JS filter over the same seeded board JSON exactly", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Cross-check Alpha", otherOwnerId);
    await insertProject(calProjectBeta, workspaceA, "Cross-check Beta", otherOwnerId);
    const bounds = monthBounds(TEST_MONTH);

    const boardAlphaCards: Record<string, unknown> = {};
    const boardBetaCards: Record<string, unknown> = {};
    const allSeededCards: Array<{ id: string; dueDate: string; completedAt: string | null }> = [];

    function seed(target: Record<string, unknown>, id: string, dueDate: string, completedAt: string | null) {
      const built = cardFixture({ id, dueDate, completedAt });
      target[id] = built;
      allSeededCards.push({ id, dueDate, completedAt });
    }

    seed(boardAlphaCards, "a1", `${TEST_MONTH}-03`, null); // 本月、未完成 → 應出現
    seed(boardAlphaCards, "a2", `${TEST_MONTH}-19`, "2026-08-20T00:00:00.000Z"); // 本月但已完成 → 不應出現
    seed(boardAlphaCards, "a3", bounds.prevLast, null); // 上月最後一天 → 不應出現
    seed(boardAlphaCards, "a4", "", null); // 空 dueDate → 不應出現在 scheduled
    seed(boardBetaCards, "b1", `${TEST_MONTH}-27`, null); // 本月、未完成 → 應出現
    seed(boardBetaCards, "b2", bounds.nextFirst, null); // 下月第一天 → 不應出現
    seed(boardBetaCards, "b3", `${TEST_MONTH}-11`, "2026-08-12T00:00:00.000Z"); // 本月但已完成 → 不應出現

    await insertBoard(calBoardAlpha, calProjectAlpha, "Cross Board Alpha", boardAlphaCards);
    await insertBoard(calBoardBeta, calProjectBeta, "Cross Board Beta", boardBetaCards);

    // 與 brief 指定的判斷式逐字一致：completedAt === null 且 dueDate.startsWith(month)。
    const expectedCardIds = allSeededCards
      .filter((card) => card.completedAt === null && card.dueDate.startsWith(TEST_MONTH))
      .map((card) => card.id);

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const actualCardIds = body.scheduled.map((card) => card.cardId);

    // 排序後比較陣列（而非用 Set），同時涵蓋「集合相同」與「無重複列」兩個斷言。
    expect(actualCardIds.slice().sort()).toEqual(expectedCardIds.slice().sort());
  });

  // 審查修正回合 1／項目 1：unscheduledTruncated 原本完全無測試覆蓋，只靠目視確認
  // 「取 201 張、切 200 張」的邏輯——Global Constraint 明文禁止靜默截斷，補上臨界值測試。
  it("caps the unscheduled pool at 200 and reports unscheduledTruncated accordingly", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);

    function buildUnscheduledCards(count: number): Record<string, unknown> {
      const cards: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const id = `card-unsched-${String(i).padStart(3, "0")}`;
        cards[id] = cardFixture({ id, dueDate: "" }); // 空 dueDate、未完成 → 落在 unscheduled 池
      }
      return cards;
    }

    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", buildUnscheduledCards(201));

    const truncatedResponse = await dispatch(
      tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(truncatedResponse.status).toBe(200);
    const truncatedBody = await truncatedResponse.json() as CalendarResponseBody;
    expect(truncatedBody.unscheduled).toHaveLength(200);
    expect(truncatedBody.unscheduledTruncated).toBe(true);

    // 201 張卡全擠在同一顆看板的 boards.data JSON blob 裡，不像 boards 表有獨立資料列
    // 可刪；改寫整份 data 讓卡數剛好收斂到 200，是驗證臨界點翻回 false 最直接的做法。
    await env.DB.prepare("UPDATE boards SET data = ? WHERE id = ?")
      .bind(boardJson(buildUnscheduledCards(200)), calBoardAlpha).run();

    const fullResponse = await dispatch(
      tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`,
    );
    expect(fullResponse.status).toBe(200);
    const fullBody = await fullResponse.json() as CalendarResponseBody;
    expect(fullBody.unscheduled).toHaveLength(200);
    expect(fullBody.unscheduledTruncated).toBe(false);
  });

  // 全分支審查修正／必修 2：持有效 token 的 contributor 只要 PUT 一張 $.cards 底下混入
  // scalar 成員（例如 "bad": "x"）的板，json_extract 對該成員求值就會噴 SQLite
  // malformed JSON，讓整個 workspace 的 GET /calendar 500。驗證 cardQuery 新增的
  // cards.type = 'object' 守門能跳過該成員，其餘正常卡片仍照常回傳 200。
  it("skips a malformed non-object $.cards member instead of 500ing the whole request", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      good: cardFixture({ id: "good", dueDate: `${TEST_MONTH}-14` }),
      bad: "x",
    });

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const allIds = [...body.scheduled, ...body.unscheduled].map((card) => card.cardId);
    expect(allIds).toEqual(["good"]);
  });

  // 人力甘特圖 v1 Task 3 複審發現的同型缺口（真實 D1 實測確認），一併補到這裡：
  // 上面那個測試守的是「$.cards 底下個別成員是 scalar」，cards.type = 'object'
  // 這條 WHERE 守得住。但最外層 json_each(json_extract(boards.data, '$.cards'))
  // 本身完全沒有守門——$.cards 這個容器本身是 scalar、或 boards.data 整份不是
  // 合法 JSON 時，json_extract 會直接對非法輸入求值並拋 malformed JSON，
  // 讓整個 workspace 的 GET /calendar 500，跟上面的洞是不同層級。寫入端只驗
  // board 整體合法，這裡讀的是既存資料，可能早於任何一版寫入驗證。
  it("survives a board whose boards.data is not valid JSON at all", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      good: cardFixture({ id: "good", dueDate: `${TEST_MONTH}-14` }),
    });
    await insertRawBoard(calBoardBeta, calProjectAlpha, "Corrupt Board", "not json at all");

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const allIds = [...body.scheduled, ...body.unscheduled].map((card) => card.cardId);
    expect(allIds).toEqual(["good"]);
  });

  it("survives a board whose $.cards itself is a scalar rather than an object", async () => {
    await insertWorkspaceMember(workspaceA, adminUserId, "admin");
    await insertProject(calProjectAlpha, workspaceA, "Calendar Alpha", otherOwnerId);
    await insertBoard(calBoardAlpha, calProjectAlpha, "Alpha Board", {
      good: cardFixture({ id: "good", dueDate: `${TEST_MONTH}-14` }),
    });
    await insertRawBoard(calBoardBeta, calProjectAlpha, "Scalar Cards Board", JSON.stringify({ cards: "not-an-object" }));

    const response = await dispatch(tokenFor(adminUserId), `/calendar?workspaceId=${workspaceA}&month=${TEST_MONTH}`);
    expect(response.status).toBe(200);
    const body = await response.json() as CalendarResponseBody;
    const allIds = [...body.scheduled, ...body.unscheduled].map((card) => card.cardId);
    expect(allIds).toEqual(["good"]);
  });
});
