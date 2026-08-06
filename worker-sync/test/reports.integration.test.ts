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
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "activity_logs", "boards", "project_members", "projects", "workspace_members",
    "workspaces", "access_tokens", "user_accounts", "migration_state",
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
    await seedFlowProject(flowProjectId, flowBoardId, board({
      completedCard: card({
        completedAt: "2026-08-03T09:00:00.000Z",
        startedAt: "2026-08-01T09:00:00.000Z",
        blockedMs: 3600000,
        serviceClass: "expedite",
      }),
    }, [], ["completedCard"]));

    const response = await dispatch(viewerToken, `/projects/${flowProjectId}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: {
        monthlyCompletions: Array<{
          cycleTimeMedianDays: number | null;
          blockedTotalMs: number;
          flowEfficiencyMedian: number | null;
          serviceClassCounts: Record<string, number>;
        }>;
      };
    };
    const current = body.summary.monthlyCompletions.at(-1)!;
    expect(current.cycleTimeMedianDays).toBe(2);
    expect(current.blockedTotalMs).toBe(3600000);
    expect(current.flowEfficiencyMedian).not.toBeNull();
    expect(current.flowEfficiencyMedian!).toBeGreaterThan(0.97);
    expect(current.flowEfficiencyMedian!).toBeLessThan(0.99);
    expect(current.serviceClassCounts.expedite).toBe(1);
  });

  it("counts a completed card with no startedAt as unmeasured without affecting the median", async () => {
    const flowProjectId = "72000000-0000-4000-8000-000000000011";
    const flowBoardId = "73000000-0000-4000-8000-000000000011";
    await seedFlowProject(flowProjectId, flowBoardId, board({
      completedCard: card({
        completedAt: new Date().toISOString(),
        startedAt: null,
      }),
    }, [], ["completedCard"]));

    const response = await dispatch(viewerToken, `/projects/${flowProjectId}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: {
        monthlyCompletions: Array<{
          cycleTimeMedianDays: number | null;
          unmeasuredCount: number;
        }>;
      };
    };
    const current = body.summary.monthlyCompletions.at(-1)!;
    expect(current.unmeasuredCount).toBe(1);
    expect(current.cycleTimeMedianDays).toBeNull();
  });

  it("treats v6 boards without flow fields as fully unmeasured with no blocked time", async () => {
    const flowProjectId = "72000000-0000-4000-8000-000000000012";
    const flowBoardId = "73000000-0000-4000-8000-000000000012";
    await seedFlowProject(flowProjectId, flowBoardId, board({
      legacyCard: card({ completedAt: new Date().toISOString() }),
    }, [], ["legacyCard"]));

    const response = await dispatch(viewerToken, `/projects/${flowProjectId}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: {
        stats: { completed: number };
        monthlyCompletions: Array<{ unmeasuredCount: number; blockedTotalMs: number }>;
      };
    };
    const current = body.summary.monthlyCompletions.at(-1)!;
    expect(current.unmeasuredCount).toBe(body.summary.stats.completed);
    expect(current.blockedTotalMs).toBe(0);
  });
});
