import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "71000000-0000-4000-8000-000000000001";
const viewerId = "71000000-0000-4000-8000-000000000002";
const outsiderId = "71000000-0000-4000-8000-000000000003";
const projectA = "72000000-0000-4000-8000-000000000001";
const projectB = "72000000-0000-4000-8000-000000000002";
const boardActive = "73000000-0000-4000-8000-000000000001";
const boardArchived = "73000000-0000-4000-8000-000000000002";
const boardOther = "73000000-0000-4000-8000-000000000003";
const viewerToken = "task7-report-viewer-runtime-token-long-value";
const outsiderToken = "task7-report-outsider-runtime-token-long-value";

function board(
  cards: Record<string, Record<string, unknown>>,
  activeIds: string[],
  completedIds: string[],
) {
  return JSON.stringify({
    version: 4,
    columns: [
      { id: "todo", cardIds: activeIds },
      { id: "done", cardIds: completedIds },
    ],
    cards,
  });
}

const DAY_MS = 24 * 3600 * 1000;

function currentTaipeiMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    title: "Card",
    description: "",
    priority: "medium",
    labelIds: [],
    dueDate: "",
    checklist: [],
    members: [],
    attachments: [],
    completedAt: null,
    ...overrides,
  };
}

async function seedFlowProject(projectId: string, boardId: string, data: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).bind(projectId, workspaceId, `Flow ${projectId.slice(-2)}`, `flow-${projectId.slice(-2)}`, viewerId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'viewer', ?, ?)`,
  ).bind(projectId, viewerId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at, archived_at, archived_by
     ) VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(boardId, projectId, `Board ${boardId.slice(-2)}`, `board-${boardId.slice(-2)}`, data, viewerId, now, now).run();
}

async function dispatch(token: string, path: string): Promise<Response> {
  return exports.default.fetch(new Request(`${endpoint}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
}

async function insertUser(id: string, token: string) {
  const now = "2026-07-27T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  ).bind(id, `User ${id.slice(-1)}`, now, now).run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'test', ?, 'personal', ?)",
  ).bind(`${id}-token`, id, await sha256Hex(token), now).run();
}

beforeAll(async () => {
  const statements = [
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
    "CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS activity_logs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, board_id TEXT, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER, metadata TEXT NOT NULL, occurred_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT, legacy_project_id TEXT, legacy_board_id TEXT, locked_at TEXT, completed_at TEXT, updated_at TEXT, error TEXT)",
    // migration 0005：看板指派表（reports.ts 透過 board-access.ts 的
    // resolveVisibleBoardIds 查詢此表，決定 contributor 可見的看板範圍）。
    `CREATE TABLE IF NOT EXISTS project_member_boards (
       project_id TEXT NOT NULL,
       user_id TEXT NOT NULL,
       board_id TEXT NOT NULL,
       assigned_by TEXT NOT NULL,
       assigned_at TEXT NOT NULL,
       PRIMARY KEY (project_id, user_id, board_id),
       FOREIGN KEY (project_id, user_id)
         REFERENCES project_members(project_id, user_id) ON DELETE CASCADE,
       FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
       FOREIGN KEY (assigned_by) REFERENCES user_accounts(id) ON DELETE RESTRICT
     )`,
    "CREATE INDEX IF NOT EXISTS task4_project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "project_member_boards", "activity_logs", "boards", "project_members", "projects",
    "workspace_members", "workspaces", "access_tokens", "user_accounts", "migration_state",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await insertUser(viewerId, viewerToken);
  await insertUser(outsiderId, outsiderToken);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO migration_state (id, status, updated_at) VALUES (1, 'complete', ?)",
  ).bind(now).run();
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', ?, ?)",
  ).bind(workspaceId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Alpha', 'alpha', 'active', ?, ?, ?),
              (?, ?, 'Beta', 'beta', 'active', ?, ?, ?)`,
  ).bind(
    projectA, workspaceId, viewerId, now, now,
    projectB, workspaceId, outsiderId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'viewer', ?, ?), (?, ?, 'manager', ?, ?)`,
  ).bind(projectA, viewerId, now, now, projectB, outsiderId, now, now).run();

  const completedAt = new Date().toISOString();
  const activeData = board({
    active: card({ dueDate: "2000-01-01" }),
    complete: card({ completedAt }),
  }, ["active"], ["complete"]);
  const archivedData = board({
    archivedComplete: card({ completedAt }),
  }, [], ["archivedComplete"]);
  const otherData = board({
    otherA: card(),
    otherB: card({ completedAt }),
  }, ["otherA"], ["otherB"]);
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at, archived_at, archived_by
     ) VALUES (?, ?, 'Active', 'active', 'active', 2, ?, ?, ?, ?, NULL, NULL),
              (?, ?, 'Archived', 'archived', 'archived', 4, ?, ?, ?, ?, ?, ?),
              (?, ?, 'Other', 'other', 'active', 8, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    boardActive, projectA, activeData, viewerId, now, now,
    boardArchived, projectA, archivedData, viewerId, now, now, now, viewerId,
    boardOther, projectB, otherData, outsiderId, now, now,
  ).run();
});

describe("Project summary API", () => {
  it("defaults to active boards and aggregates six months with zero months", async () => {
    const response = await dispatch(viewerToken, `/projects/${projectA}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      projectId: string;
      summary: {
        includeArchived: boolean;
        boardCount: number;
        stats: { total: number; active: number; completed: number; overdue: number };
        boards: Array<{ id: string }>;
        monthlyCompletions: Array<{ month: string; count: number }>;
        timeZone: string;
      };
    };
    expect(body.projectId).toBe(projectA);
    expect(body.summary.includeArchived).toBe(false);
    expect(body.summary.boardCount).toBe(1);
    expect(body.summary.boards.map((item) => item.id)).toEqual([boardActive]);
    expect(body.summary.stats).toEqual({ total: 2, active: 1, completed: 1, overdue: 1 });
    expect(body.summary.monthlyCompletions).toHaveLength(6);
    expect(body.summary.monthlyCompletions.reduce((sum, item) => sum + item.count, 0)).toBe(1);
    expect(body.summary.monthlyCompletions.some((item) => item.count === 0)).toBe(true);
    expect(body.summary.timeZone).toBe("Asia/Taipei");
  });

  it("includes archived boards only when requested and never crosses projects", async () => {
    const response = await dispatch(
      viewerToken,
      `/projects/${projectA}/summary?includeArchived=true`,
    );
    const body = await response.json() as {
      summary: {
        boardCount: number;
        stats: { total: number; completed: number };
        boards: Array<{ id: string }>;
      };
    };
    expect(body.summary.boardCount).toBe(2);
    expect(body.summary.stats).toMatchObject({ total: 3, completed: 2 });
    expect(body.summary.boards.map((item) => item.id).sort()).toEqual(
      [boardActive, boardArchived].sort(),
    );
    expect(body.summary.boards.some((item) => item.id === boardOther)).toBe(false);
  });

  it("allows archived-project history, hides non-members, and validates options", async () => {
    await env.DB.prepare(
      "UPDATE projects SET status = 'archived', archived_at = ? WHERE id = ?",
    ).bind(new Date().toISOString(), projectA).run();
    expect((await dispatch(viewerToken, `/projects/${projectA}/summary`)).status).toBe(200);
    expect((await dispatch(outsiderToken, `/projects/${projectA}/summary`)).status).toBe(404);
    expect(
      (await dispatch(viewerToken, `/projects/${projectA}/summary?includeArchived=yes`)).status,
    ).toBe(400);
  });

  it("computes cycle time, blocked time and flow efficiency for a completed card", async () => {
    const flowProjectId = "72000000-0000-4000-8000-000000000010";
    const flowBoardId = "73000000-0000-4000-8000-000000000010";
    const completedAt = new Date();
    const startedAt = new Date(completedAt.getTime() - 2 * DAY_MS);
    await seedFlowProject(flowProjectId, flowBoardId, board({
      completedCard: card({
        completedAt: completedAt.toISOString(),
        startedAt: startedAt.toISOString(),
        blockedMs: 3600000,
        serviceClass: "expedite",
      }),
    }, [], ["completedCard"]));

    const response = await dispatch(viewerToken, `/projects/${flowProjectId}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: {
        monthlyCompletions: Array<{
          month: string;
          cycleTimeMedianDays: number | null;
          blockedTotalMs: number;
          flowEfficiencyMedian: number | null;
          serviceClassCounts: Record<string, number>;
        }>;
      };
    };
    const monthKey = currentTaipeiMonthKey(completedAt);
    const current = body.summary.monthlyCompletions.find((item) => item.month === monthKey);
    expect(current).toBeDefined();
    expect(current!.cycleTimeMedianDays).toBe(2);
    expect(current!.blockedTotalMs).toBe(3600000);
    expect(current!.flowEfficiencyMedian).not.toBeNull();
    expect(current!.flowEfficiencyMedian!).toBeGreaterThan(0.97);
    expect(current!.flowEfficiencyMedian!).toBeLessThan(0.99);
    expect(current!.serviceClassCounts.expedite).toBe(1);
  });

  it("counts a completed card with no startedAt as unmeasured without affecting the median", async () => {
    const flowProjectId = "72000000-0000-4000-8000-000000000011";
    const flowBoardId = "73000000-0000-4000-8000-000000000011";
    const completedAt = new Date();
    await seedFlowProject(flowProjectId, flowBoardId, board({
      completedCard: card({
        completedAt: completedAt.toISOString(),
        startedAt: null,
      }),
    }, [], ["completedCard"]));

    const response = await dispatch(viewerToken, `/projects/${flowProjectId}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: {
        monthlyCompletions: Array<{
          month: string;
          cycleTimeMedianDays: number | null;
          unmeasuredCount: number;
        }>;
      };
    };
    const monthKey = currentTaipeiMonthKey(completedAt);
    const current = body.summary.monthlyCompletions.find((item) => item.month === monthKey);
    expect(current).toBeDefined();
    expect(current!.unmeasuredCount).toBe(1);
    expect(current!.cycleTimeMedianDays).toBeNull();
  });

  it("treats boards without flow fields (legacy schema) as fully unmeasured with no blocked time", async () => {
    const flowProjectId = "72000000-0000-4000-8000-000000000012";
    const flowBoardId = "73000000-0000-4000-8000-000000000012";
    const completedAt = new Date();
    await seedFlowProject(flowProjectId, flowBoardId, board({
      legacyCard: card({ completedAt: completedAt.toISOString() }),
    }, [], ["legacyCard"]));

    const response = await dispatch(viewerToken, `/projects/${flowProjectId}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: {
        stats: { completed: number };
        monthlyCompletions: Array<{ month: string; unmeasuredCount: number; blockedTotalMs: number }>;
      };
    };
    const monthKey = currentTaipeiMonthKey(completedAt);
    const current = body.summary.monthlyCompletions.find((item) => item.month === monthKey);
    expect(current).toBeDefined();
    expect(current!.unmeasuredCount).toBe(body.summary.stats.completed);
    expect(current!.blockedTotalMs).toBe(0);
  });

  it("scopes a contributor without assignment rows to the primary board, while an owner sees every board", async () => {
    const scopedProjectId = "72000000-0000-4000-8000-000000000020";
    const boardA = "73000000-0000-4000-8000-000000000020";
    const boardB = "73000000-0000-4000-8000-000000000021";
    const ownerId = "71000000-0000-4000-8000-000000000004";
    const contributorId = "71000000-0000-4000-8000-000000000005";
    const ownerToken = "task4-summary-owner-runtime-token-long-value";
    const contributorToken = "task4-summary-contributor-runtime-token-long-value";
    await insertUser(ownerId, ownerToken);
    await insertUser(contributorId, contributorToken);

    const now = new Date();
    const completedAt = now.toISOString();
    // boardB 是較晚更新的 active board，依 primaryBoardId 規則（updated_at DESC,
    // id DESC）成為無指派列 contributor 的 fallback 主要看板。
    const olderUpdatedAt = new Date(now.getTime() - DAY_MS).toISOString();
    const newerUpdatedAt = now.toISOString();

    await env.DB.prepare(
      `INSERT INTO projects (
         id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
       ) VALUES (?, ?, 'Scoped', 'scoped', 'active', ?, ?, ?)`,
    ).bind(scopedProjectId, workspaceId, ownerId, newerUpdatedAt, newerUpdatedAt).run();
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'manager', ?, ?), (?, ?, 'contributor', ?, ?)`,
    ).bind(
      scopedProjectId, ownerId, newerUpdatedAt, newerUpdatedAt,
      scopedProjectId, contributorId, newerUpdatedAt, newerUpdatedAt,
    ).run();
    await env.DB.prepare(
      `INSERT INTO boards (
         id, project_id, name, normalized_name, status, revision, data,
         created_by, created_at, updated_at, archived_at, archived_by
       ) VALUES (?, ?, 'Board A', 'board-a-scoped', 'active', 1, ?, ?, ?, ?, NULL, NULL),
                (?, ?, 'Board B', 'board-b-scoped', 'active', 1, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      boardA, scopedProjectId,
      board({ cardA: card({ completedAt }) }, [], ["cardA"]), ownerId, olderUpdatedAt, olderUpdatedAt,
      boardB, scopedProjectId,
      board({ cardB: card({ completedAt }) }, [], ["cardB"]), ownerId, newerUpdatedAt, newerUpdatedAt,
    ).run();

    type SummaryBody = {
      summary: {
        boardCount: number;
        boards: Array<{ id: string }>;
        stats: { completed: number };
        monthlyCompletions: Array<{ month: string; count: number }>;
      };
    };
    const monthKey = currentTaipeiMonthKey(now);

    const contributorResponse = await dispatch(
      contributorToken,
      `/projects/${scopedProjectId}/summary`,
    );
    expect(contributorResponse.status).toBe(200);
    const contributorBody = await contributorResponse.json() as SummaryBody;
    expect(contributorBody.summary.boardCount).toBe(1);
    expect(contributorBody.summary.boards.map((item) => item.id)).toEqual([boardB]);
    expect(contributorBody.summary.stats.completed).toBe(1);
    const contributorMonth = contributorBody.summary.monthlyCompletions.find(
      (item) => item.month === monthKey,
    );
    expect(contributorMonth).toBeDefined();
    expect(contributorMonth!.count).toBe(1);

    const ownerResponse = await dispatch(ownerToken, `/projects/${scopedProjectId}/summary`);
    expect(ownerResponse.status).toBe(200);
    const ownerBody = await ownerResponse.json() as SummaryBody;
    expect(ownerBody.summary.boardCount).toBe(2);
    expect(ownerBody.summary.boards.map((item) => item.id).sort()).toEqual([boardA, boardB].sort());
    expect(ownerBody.summary.stats.completed).toBe(2);
    const ownerMonth = ownerBody.summary.monthlyCompletions.find(
      (item) => item.month === monthKey,
    );
    expect(ownerMonth).toBeDefined();
    expect(ownerMonth!.count).toBe(2);
  });
});
