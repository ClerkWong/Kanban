import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

// --- Task 3：GET /assignments 專用 fixture。複製自
// worker-sync/test/calendar.integration.test.ts 的 helper 形狀（workspace／project／
// board／member／token 建立與 seed board），只改資料內容——resolveCalendarScope 本身
// 的範圍邏輯已在該檔案窮盡測試，這裡不重複，只驗證 assignments.ts 正確消費它。

const WORKSPACE_ID = "80000000-0000-4000-8000-000000000001";

const adminUserId = "81000000-0000-4000-8000-000000000001";
const managerUserId = "81000000-0000-4000-8000-000000000002"; // project owner（D1 role 'manager'）
const contributorUserId = "81000000-0000-4000-8000-000000000003";
const outsiderId = "81000000-0000-4000-8000-000000000004"; // 有效 token，但非 workspace 成員
const creatorId = "81000000-0000-4000-8000-000000000005"; // project/board created_by 填充值

const ALICE = "81000000-0000-4000-8000-000000000006";
const BOB = "81000000-0000-4000-8000-000000000007";
const CAROL = "81000000-0000-4000-8000-000000000008"; // 離開專案但指派仍保留
const DAVE = "81000000-0000-4000-8000-000000000009"; // 專案成員，這段期間零條子

const projectAlpha = "82000000-0000-4000-8000-000000000001";
const projectBeta = "82000000-0000-4000-8000-000000000002";
const projectArchived = "82000000-0000-4000-8000-000000000003";
const projectManaged = "82000000-0000-4000-8000-000000000004";
const projectUnowned = "82000000-0000-4000-8000-000000000005";
const projectContribHome = "82000000-0000-4000-8000-000000000006";

const boardAlpha = "83000000-0000-4000-8000-000000000001";
const boardBeta = "83000000-0000-4000-8000-000000000002";
const boardArchived = "83000000-0000-4000-8000-000000000003";
const boardInArchivedProject = "83000000-0000-4000-8000-000000000004";
const boardManaged = "83000000-0000-4000-8000-000000000005";
const boardUnowned = "83000000-0000-4000-8000-000000000006";

const FROM = "2026-08-07";
const TO = "2026-08-17";

function tokenFor(userId: string): string {
  return `assignments-test-token-${userId}`;
}

type AssignmentsBar = {
  userId: string;
  cardId: string;
  title: string;
  startDate: string;
  endDate: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
  blocked: boolean;
  serviceClass: string;
};

type AssignmentsUnscheduled = {
  cardId: string;
  title: string;
  userId: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
};

type AssignmentsResponseBody = {
  from: string;
  to: string;
  scope: "workspace" | "owned_projects";
  people: Array<{ userId: string; displayName: string }>;
  bars: AssignmentsBar[];
  unscheduled: AssignmentsUnscheduled[];
  barsTruncated: boolean;
  unscheduledTruncated: boolean;
  boardsTruncated: boolean;
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

async function insertToken(userId: string) {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'test', ?, 'personal', ?)",
  ).bind(`${userId}-assignments-token`, userId, await sha256Hex(tokenFor(userId)), now).run();
}

async function insertMigrationComplete() {
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'complete', ?, ?, ?, ?)`,
  ).bind(
    WORKSPACE_ID,
    "86000000-0000-4000-8000-000000000000",
    "86000000-0000-4000-8000-000000000001",
    now,
  ).run();
}

type WindowOverride = { userId: string; startDate: string; endDate: string };

type CardOverrides = {
  id: string;
  title?: string;
  completedAt?: string | null;
  blocked?: boolean;
  serviceClass?: string;
  assigneeUserIds?: string[];
  assignmentWindows?: WindowOverride[];
  description?: string;
  blockedReason?: string;
  checklist?: unknown[];
  attachments?: unknown[];
};

/** schema v8 卡片的最小可用形狀（含 assigneeUserIds／assignmentWindows）；
 *  description／checklist／attachments／blockedReason 只在明確傳入時才附加，
 *  用於洩漏測試的 SECRET_MARKER 斷言。 */
function cardFixture(overrides: CardOverrides): Record<string, unknown> {
  const { id, title, completedAt, blocked, serviceClass, assigneeUserIds, assignmentWindows } = overrides;
  return {
    id,
    title: title ?? `Card ${id}`,
    dueDate: "",
    completedAt: completedAt ?? null,
    blocked: blocked ?? false,
    serviceClass: serviceClass ?? "standard",
    assigneeUserIds: assigneeUserIds ?? [],
    assignmentWindows: assignmentWindows ?? [],
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    ...(overrides.blockedReason !== undefined ? { blockedReason: overrides.blockedReason } : {}),
    ...(overrides.checklist !== undefined ? { checklist: overrides.checklist } : {}),
    ...(overrides.attachments !== undefined ? { attachments: overrides.attachments } : {}),
  };
}

function boardJson(cards: Record<string, unknown>): string {
  return JSON.stringify({
    version: 8,
    columns: [{ id: "todo", title: "Todo", wipLimit: null, cardIds: Object.keys(cards) }],
    cards,
    labels: [],
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
    creatorId,
    updatedAt,
    updatedAt,
  ).run();
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
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT NOT NULL, legacy_project_id TEXT NOT NULL, legacy_board_id TEXT NOT NULL, locked_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, error TEXT)",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "boards", "project_members", "projects",
    "workspace_members", "workspaces", "access_tokens", "user_accounts", "migration_state",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const now = "2026-08-12T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace A', ?, ?)",
  ).bind(WORKSPACE_ID, now, now).run();
  await insertMigrationComplete();
  for (const id of [adminUserId, managerUserId, contributorUserId, outsiderId, creatorId]) {
    await insertUser(id);
    await insertToken(id);
  }
});

describe("GET /assignments", () => {
  // 模板案例：brief Step 2 指定的完整範例，驗證同一張卡的兩位指派人各自出現一條、
  // 各自使用自己的起訖日。
  it("returns one bar per assignee window that overlaps the range", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertUser(BOB);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      c1: cardFixture({
        id: "c1",
        title: "共同任務",
        assigneeUserIds: [ALICE, BOB],
        assignmentWindows: [
          { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" },
          { userId: BOB, startDate: "2026-08-07", endDate: "2026-08-12" },
        ],
      }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.scope).toBe("workspace");
    expect(body.bars).toHaveLength(2);
    expect(body.bars.map((bar) => [bar.userId, bar.startDate, bar.endDate]).sort())
      .toEqual([
        [ALICE, "2026-08-07", "2026-08-13"],
        [BOB, "2026-08-07", "2026-08-12"],
      ].sort());
    expect(body.bars.every((bar) => bar.title === "共同任務")).toBe(true);
    expect(body.unscheduled).toHaveLength(0);
    expect(body.barsTruncated).toBe(false);
  });

  it("returns 401 without a token", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    const response = await dispatch(null, `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("returns 400 for a malformed range", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    const token = tokenFor(adminUserId);
    const badQueries = [
      `workspaceId=${WORKSPACE_ID}&from=2026-8-07&to=${TO}`, // 格式錯：月份缺前導 0
      `workspaceId=${WORKSPACE_ID}&from=${TO}&to=${FROM}`, // from > to
      `workspaceId=${WORKSPACE_ID}&from=2026-08-01&to=2026-09-01`, // 32 天（含頭尾）
      `workspaceId=${WORKSPACE_ID}&to=${TO}`, // 缺 from
    ];
    for (const qs of badQueries) {
      const response = await dispatch(token, `/assignments?${qs}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_range" });
    }
  });

  it("accepts a 31-day window inclusive of both ends", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    const response = await dispatch(
      tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=2026-08-01&to=2026-08-31`,
    );
    expect(response.status).toBe(200);
  });

  it("gives a workspace admin every active project in the workspace", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertProject(projectBeta, WORKSPACE_ID, "Beta", creatorId);
    await insertUser(ALICE);
    // adminUserId 刻意不加入任何 project_members——驗證「不是成員的專案」也在範圍內。
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      a1: cardFixture({
        id: "a1", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
    });
    await insertBoard(boardBeta, projectBeta, "Beta Board", {
      b1: cardFixture({
        id: "b1", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-09", endDate: "2026-08-10" }],
      }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.scope).toBe("workspace");
    expect(body.bars.map((bar) => bar.cardId).sort()).toEqual(["a1", "b1"]);
  });

  it("gives a project owner only the projects they own", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, managerUserId, "member");
    await insertProject(projectManaged, WORKSPACE_ID, "Managed", managerUserId);
    await insertProjectMember(projectManaged, managerUserId, "manager");
    await insertProject(projectUnowned, WORKSPACE_ID, "Unowned", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardManaged, projectManaged, "Managed Board", {
      m1: cardFixture({
        id: "m1", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
    });
    await insertBoard(boardUnowned, projectUnowned, "Unowned Board", {
      u1: cardFixture({
        id: "u1", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
    });

    const response = await dispatch(tokenFor(managerUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.scope).toBe("owned_projects");
    expect(body.bars.map((bar) => bar.cardId)).toEqual(["m1"]);
  });

  it("returns 403 for a member and 404 for a non-workspace user", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, contributorUserId, "member");
    await insertProject(projectContribHome, WORKSPACE_ID, "Contributor Home", creatorId);
    await insertProjectMember(projectContribHome, contributorUserId, "contributor");

    const memberResponse = await dispatch(
      tokenFor(contributorUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`,
    );
    expect(memberResponse.status).toBe(403);
    expect(await memberResponse.json()).toMatchObject({ error: "forbidden" });

    // outsiderId 有合法 token，但沒有 workspaceA 的 workspace_members 列。
    const outsiderResponse = await dispatch(
      tokenFor(outsiderId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`,
    );
    expect(outsiderResponse.status).toBe(404);
    expect(await outsiderResponse.json()).toMatchObject({ error: "not_found" });
  });

  it("excludes windows entirely outside the range", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      c1: cardFixture({
        id: "c1", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-01", endDate: "2026-08-05" }],
      }),
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars).toHaveLength(0);
  });

  it("includes windows that straddle the range boundary", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertUser(BOB);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      early: cardFixture({
        id: "early", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-05", endDate: "2026-08-09" }],
      }),
      late: cardFixture({
        id: "late", assigneeUserIds: [BOB],
        assignmentWindows: [{ userId: BOB, startDate: "2026-08-15", endDate: "2026-08-20" }],
      }),
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars.map((bar) => bar.cardId).sort()).toEqual(["early", "late"]);
  });

  it("excludes completed cards, archived boards and archived projects", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertProject(projectArchived, WORKSPACE_ID, "Archived Project", creatorId, "archived");
    await insertUser(ALICE);
    const win = { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" };
    await insertBoard(boardAlpha, projectAlpha, "Active Board", {
      open: cardFixture({ id: "open", assigneeUserIds: [ALICE], assignmentWindows: [win] }),
      done: cardFixture({
        id: "done", assigneeUserIds: [ALICE], assignmentWindows: [win],
        completedAt: "2026-08-06T00:00:00.000Z",
      }),
    });
    await insertBoard(boardArchived, projectAlpha, "Archived Board", {
      archivedBoardCard: cardFixture({ id: "archivedBoardCard", assigneeUserIds: [ALICE], assignmentWindows: [win] }),
    }, { status: "archived" });
    await insertBoard(boardInArchivedProject, projectArchived, "Board In Archived Project", {
      archivedProjectCard: cardFixture({ id: "archivedProjectCard", assigneeUserIds: [ALICE], assignmentWindows: [win] }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars.map((bar) => bar.cardId)).toEqual(["open"]);
  });

  it("lists assignees without a window as unscheduled", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      c1: cardFixture({ id: "c1", title: "待排期任務", assigneeUserIds: [ALICE], assignmentWindows: [] }),
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars).toHaveLength(0);
    expect(body.unscheduled).toHaveLength(1);
    expect(body.unscheduled[0]).toMatchObject({ cardId: "c1", title: "待排期任務", userId: ALICE });
  });

  it("omits cards with no assignees entirely", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      c1: cardFixture({ id: "c1", assigneeUserIds: [], assignmentWindows: [] }),
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars).toHaveLength(0);
    expect(body.unscheduled).toHaveLength(0);
  });

  it("lists project members who have no bars in the range", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(DAVE);
    await insertProjectMember(projectAlpha, DAVE, "contributor");
    // 沒有任何看板／卡片——DAVE 應該仍出現在 people，顯示為空白列。
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.people.map((p) => p.userId)).toContain(DAVE);
  });

  it("keeps a departed assignee in people, ordered after current members", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(DAVE);
    await insertProjectMember(projectAlpha, DAVE, "contributor");
    await insertUser(CAROL);
    await insertProjectMember(projectAlpha, CAROL, "contributor");
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      c1: cardFixture({
        id: "c1", assigneeUserIds: [CAROL],
        assignmentWindows: [{ userId: CAROL, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
    });
    // CAROL 離開專案，但卡片上的指派與 window 都還在。
    await env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .bind(projectAlpha, CAROL).run();

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    const ids = body.people.map((p) => p.userId);
    expect(ids).toContain(CAROL);
    expect(ids).toContain(DAVE);
    expect(ids.indexOf(CAROL)).toBeGreaterThan(ids.indexOf(DAVE));
  });

  it("survives a scalar card member", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      good: cardFixture({
        id: "good", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
      bad: "x",
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars.map((bar) => bar.cardId)).toEqual(["good"]);
  });

  it("survives a scalar assignmentWindows member", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      c1: {
        ...cardFixture({ id: "c1", assigneeUserIds: [ALICE] }),
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }, "scalar"],
      },
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars).toHaveLength(1);
    expect(body.bars[0]).toMatchObject({ cardId: "c1", userId: ALICE });
  });

  it("survives a scalar assignmentWindows value", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      bad: { ...cardFixture({ id: "bad", title: "Bad Card", assigneeUserIds: [ALICE] }), assignmentWindows: "scalar" },
      good: cardFixture({
        id: "good", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    // "bad" 卡的 assignmentWindows 整個是 scalar：沒有可展開的 window，不會出現在
    // bars；但 windows_json 解析失敗比照「沒有任何 window」，ALICE 的指派仍要浮出
    // 在 unscheduled——不能讓壞資料使這筆指派悄悄消失。
    expect(body.bars.map((bar) => bar.cardId)).toEqual(["good"]);
    expect(body.unscheduled).toHaveLength(1);
    expect(body.unscheduled[0]).toMatchObject({ cardId: "bad", userId: ALICE, title: "Bad Card" });
  });

  it("flags boardsTruncated at 51 active boards and clears at 50", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    const total = 51;
    for (let i = 0; i < total; i += 1) {
      const boardId = `board-many-${String(i).padStart(3, "0")}`;
      const updatedAt = `2026-08-01T00:${String(i).padStart(2, "0")}:00.000Z`;
      await insertBoard(boardId, projectAlpha, `Board ${i}`, {
        [`card-${i}`]: cardFixture({ id: `card-${i}` }),
      }, { updatedAt });
    }

    const truncated = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(truncated.status).toBe(200);
    expect(((await truncated.json()) as AssignmentsResponseBody).boardsTruncated).toBe(true);

    await env.DB.prepare("DELETE FROM boards WHERE id = ?").bind("board-many-000").run();
    const full = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(full.status).toBe(200);
    expect(((await full.json()) as AssignmentsResponseBody).boardsTruncated).toBe(false);
  });

  it("flags barsTruncated at 2001 bars and clears at 2000", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);

    function buildCards(count: number): Record<string, unknown> {
      const cards: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const id = `bar-card-${String(i).padStart(4, "0")}`;
        cards[id] = cardFixture({
          id, assigneeUserIds: [ALICE],
          assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
        });
      }
      return cards;
    }

    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", buildCards(2001));
    const truncated = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(truncated.status).toBe(200);
    const truncatedBody = (await truncated.json()) as AssignmentsResponseBody;
    expect(truncatedBody.bars).toHaveLength(2000);
    expect(truncatedBody.barsTruncated).toBe(true);

    await env.DB.prepare("UPDATE boards SET data = ? WHERE id = ?")
      .bind(boardJson(buildCards(2000)), boardAlpha).run();
    const full = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(full.status).toBe(200);
    const fullBody = (await full.json()) as AssignmentsResponseBody;
    expect(fullBody.bars).toHaveLength(2000);
    expect(fullBody.barsTruncated).toBe(false);
  });

  it("flags unscheduledTruncated at 201 unscheduled items and clears at 200", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);

    function buildCards(count: number): Record<string, unknown> {
      const cards: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const id = `unsched-card-${String(i).padStart(3, "0")}`;
        cards[id] = cardFixture({ id, assigneeUserIds: [ALICE], assignmentWindows: [] });
      }
      return cards;
    }

    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", buildCards(201));
    const truncated = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(truncated.status).toBe(200);
    const truncatedBody = (await truncated.json()) as AssignmentsResponseBody;
    expect(truncatedBody.unscheduled).toHaveLength(200);
    expect(truncatedBody.unscheduledTruncated).toBe(true);

    await env.DB.prepare("UPDATE boards SET data = ? WHERE id = ?")
      .bind(boardJson(buildCards(200)), boardAlpha).run();
    const full = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(full.status).toBe(200);
    const fullBody = (await full.json()) as AssignmentsResponseBody;
    expect(fullBody.unscheduled).toHaveLength(200);
    expect(fullBody.unscheduledTruncated).toBe(false);
  });

  // 控制者裁決（非 brief 原文，見任務報告）：brief 的 assignedCardQuery 用
  // LIMIT MAX_UNSCHEDULED*10+1，且要求「原始列數達到這個 LIMIT 時 unscheduledTruncated
  // 一律為 true」。這裡刻意讓 2001 張卡「全部都有合法 window」（真正未排期數＝0，
  // 遠低於 200），只用來頂到 assignedCardQuery 的原始列數上限——如果只看「篩完後
  // 的未排期筆數 > 200」，這裡永遠算不出 truncated，但 LIMIT 之外可能還有更多卡片
  // 存在、根本沒被看到，無法排除那些卡片裡有未排期的指派，必須無條件視為 truncated。
  it("forces unscheduledTruncated when the raw row count hits the LIMIT even though few cards are actually unscheduled", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);

    function buildCards(count: number): Record<string, unknown> {
      const cards: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const id = `raw-limit-card-${String(i).padStart(4, "0")}`;
        cards[id] = cardFixture({
          id, assigneeUserIds: [ALICE],
          assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
        });
      }
      return cards;
    }

    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", buildCards(2001));
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssignmentsResponseBody;
    expect(body.unscheduled).toHaveLength(0);
    expect(body.unscheduledTruncated).toBe(true);
  });

  // 控制者裁決（非 brief 原文，見任務報告）：Task 2 審查留下的 minor——寫入端
  // DATE_ONLY（worker-sync/src/boards.ts）只驗格式（/^\d{4}-\d{2}-\d{2}$/），不驗
  // 日曆合法性，故「2026-13-45」這種值可能已經入庫。直接寫 DB 略過應用層驗證，
  // 模擬「早於本次驗證版本」的既存資料：endDate 月份 13 不合法，但字串比較不會讓
  // SQL 出錯（"2026-13-45" >= from 恆成立），必須在轉換階段用同一顆 DATE_ONLY 再篩一次。
  it("skips a bar whose window date fails calendar validation even though it passed the write-time format check", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertUser(BOB);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      bad: cardFixture({
        id: "bad", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-10", endDate: "2026-13-45" }],
      }),
      good: cardFixture({
        id: "good", assigneeUserIds: [BOB],
        assignmentWindows: [{ userId: BOB, startDate: "2026-08-07", endDate: "2026-08-08" }],
      }),
    });

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssignmentsResponseBody;
    expect(body.bars.map((bar) => bar.cardId)).toEqual(["good"]);
  });

  // 控制者裁決（非 brief 原文，見任務報告）：barsTruncated 的縱深防禦與截斷旗標
  // 之間有一個 brief 沒提到、但邏輯上對稱於 unscheduledTruncated 的洞——單一 chunk
  // 的 barQuery 原始列數頂到 LIMIT（MAX_BARS+1）代表「這個 chunk 底下可能還有更多
  // bar 被 SQL 的 LIMIT 切掉」，但如果這批原始列裡有一部份因為 toBar 的 DATE_ONLY
  // 縱深防禦被篩掉，篩完後的合併筆數可能低於 MAX_BARS，若只看「篩完後筆數 >
  // MAX_BARS」會誤判成沒有截斷。用 2001 筆原始 bar（剛好頂到 LIMIT），其中 200 筆
  // 因不合法日曆日期被篩掉，篩後剩 1801（< 2000）——沒有 barsRawHitLimit 這道旗標
  // 會誤報 false。
  it("forces barsTruncated when the raw row count hits the LIMIT even after depth-defense filtering drops the merged count below MAX_BARS", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);

    function buildCards(total: number, invalidCount: number): Record<string, unknown> {
      const cards: Record<string, unknown> = {};
      for (let i = 0; i < total; i += 1) {
        const id = `raw-limit-bar-${String(i).padStart(4, "0")}`;
        const endDate = i < invalidCount ? "2026-13-45" : "2026-08-08"; // 前 invalidCount 筆日曆不合法
        cards[id] = cardFixture({
          id, assigneeUserIds: [ALICE],
          assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate }],
        });
      }
      return cards;
    }

    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", buildCards(2001, 200));
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AssignmentsResponseBody;
    expect(body.bars.length).toBeLessThan(2000); // 篩後合併筆數確實低於 MAX_BARS
    expect(body.barsTruncated).toBe(true); // 但原始列數頂到 LIMIT，仍必須視為截斷
  });

  it("never leaks description, checklist, attachments or blocked reason", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertBoard(boardAlpha, projectAlpha, "Alpha Board", {
      secret: cardFixture({
        id: "secret", assigneeUserIds: [ALICE],
        assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
        description: "SECRET_MARKER_DESCRIPTION_9f3a",
        blockedReason: "SECRET_MARKER_BLOCKEDREASON_9f3a",
        checklist: [{ id: "chk-1", text: "SECRET_MARKER_CHECKLIST_9f3a", done: false }],
        attachments: [{
          id: "att-1", type: "photo", fileName: "SECRET_MARKER_ATTACHMENT_9f3a",
          mimeType: "image/png", size: 10, createdAt: "2026-08-01T00:00:00.000Z",
        }],
      }),
    });
    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("SECRET_MARKER");
  });

  // 與 brief 指定的判斷式逐字一致：completedAt === null 且 window 與查詢窗重疊
  // （startDate <= to && endDate >= from）。
  it("matches an independent JS filter over the same fixture", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertProject(projectAlpha, WORKSPACE_ID, "Alpha", creatorId);
    await insertUser(ALICE);
    await insertUser(BOB);

    type Seed = {
      id: string;
      assigneeUserIds: string[];
      windows: WindowOverride[];
      completedAt: string | null;
    };
    const seeds: Seed[] = [
      {
        id: "x1", assigneeUserIds: [ALICE],
        windows: [{ userId: ALICE, startDate: "2026-08-01", endDate: "2026-08-08" }],
        completedAt: null,
      }, // 跨進窗口左緣 → 應出現
      {
        id: "x2", assigneeUserIds: [ALICE],
        windows: [{ userId: ALICE, startDate: "2026-08-20", endDate: "2026-08-25" }],
        completedAt: null,
      }, // 完全在窗外 → 不應出現
      {
        id: "x3", assigneeUserIds: [BOB],
        windows: [{ userId: BOB, startDate: "2026-08-09", endDate: "2026-08-11" }],
        completedAt: "2026-08-09T00:00:00.000Z",
      }, // 已完成 → 不應出現
      {
        id: "x4", assigneeUserIds: [BOB, ALICE],
        windows: [
          { userId: BOB, startDate: "2026-08-12", endDate: "2026-08-14" },
          { userId: ALICE, startDate: "2026-08-16", endDate: "2026-08-18" },
        ],
        completedAt: null,
      }, // 兩人各自的 window → 都應出現
    ];
    const cardsAlpha: Record<string, unknown> = {};
    for (const seed of seeds) {
      cardsAlpha[seed.id] = cardFixture({
        id: seed.id,
        assigneeUserIds: seed.assigneeUserIds,
        assignmentWindows: seed.windows,
        completedAt: seed.completedAt,
      });
    }
    await insertBoard(boardAlpha, projectAlpha, "Cross Board Alpha", cardsAlpha);

    const expectedBars = seeds
      .filter((seed) => seed.completedAt === null)
      .flatMap((seed) => seed.windows
        .filter((w) => w.startDate <= TO && w.endDate >= FROM)
        .map((w) => `${seed.id}:${w.userId}:${w.startDate}:${w.endDate}`));

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    const actualBars = body.bars.map((bar) => `${bar.cardId}:${bar.userId}:${bar.startDate}:${bar.endDate}`);
    expect(actualBars.slice().sort()).toEqual(expectedBars.slice().sort());
  });

  it("works with more than 99 projects (bind chunking)", async () => {
    await insertWorkspaceMember(WORKSPACE_ID, adminUserId, "admin");
    await insertUser(ALICE);
    const totalProjects = 101;
    const firstCardId = "bulk-card-0";
    const lastCardId = `bulk-card-${totalProjects - 1}`;
    for (let i = 0; i < totalProjects; i += 1) {
      const projectId = `90000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
      await insertProject(projectId, WORKSPACE_ID, `Bulk Project ${i}`, creatorId);
      if (i === 0 || i === totalProjects - 1) {
        const boardId = `91000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
        await insertBoard(boardId, projectId, `Bulk Board ${i}`, {
          [`bulk-card-${i}`]: cardFixture({
            id: `bulk-card-${i}`, assigneeUserIds: [ALICE],
            assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" }],
          }),
        });
      }
    }

    const response = await dispatch(tokenFor(adminUserId), `/assignments?workspaceId=${WORKSPACE_ID}&from=${FROM}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json() as AssignmentsResponseBody;
    expect(body.bars.map((bar) => bar.cardId).sort()).toEqual([firstCardId, lastCardId].sort());
  });
});
