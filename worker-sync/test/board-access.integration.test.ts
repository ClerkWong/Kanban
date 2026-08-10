import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ProjectAccess } from "../src/authorization";
import { requireBoardVisible, resolveVisibleBoardIds } from "../src/board-access";
import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "31000000-0000-4000-8000-000000000001";
const managerId = "31000000-0000-4000-8000-000000000002";
const contributorId = "31000000-0000-4000-8000-000000000003";
const viewerId = "31000000-0000-4000-8000-000000000004";
const projectA = "41000000-0000-4000-8000-000000000001";
const boardA = "51000000-0000-4000-8000-000000000001";
const boardB = "51000000-0000-4000-8000-000000000002";
const managerToken = "board-access-manager-runtime-token-long-value";
const contributorToken = "board-access-contributor-runtime-token-long-value";
const viewerToken = "board-access-viewer-runtime-token-long-value";

const contributorAccess: ProjectAccess = {
  workspaceRole: null,
  projectRole: "contributor",
  projectStatus: "active",
};
const managerAccess: ProjectAccess = {
  workspaceRole: null,
  projectRole: "manager",
  projectStatus: "active",
};
const viewerAccess: ProjectAccess = {
  workspaceRole: null,
  projectRole: "viewer",
  projectStatus: "active",
};

function board(marker = "default"): Record<string, unknown> {
  return { version: 3, columns: [], cards: {}, marker };
}

async function dispatch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return exports.default.fetch(new Request(`${endpoint}${path}`, { ...init, headers }));
}

async function insertUser(id: string, token: string) {
  const now = "2026-08-10T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  ).bind(id, `User ${id.slice(-1)}`, now, now).run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'test', ?, 'personal', ?)",
  ).bind(`${id}-token`, id, await sha256Hex(token), now).run();
}

async function createBoard(
  token: string,
  projectId: string,
  id: string,
  name: string,
  data: Record<string, unknown> = board(),
) {
  return dispatch(token, `/projects/${projectId}/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name, board: data }),
  });
}

/** 直接寫入 boards row，跳過 API，以便精準控制 updated_at 來決定 primary board。 */
async function insertBoard(
  id: string,
  projectId: string,
  name: string,
  updatedAt: string,
  status: "active" | "archived" = "active",
) {
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
    status,
    JSON.stringify(board(name)),
    managerId,
    updatedAt,
    updatedAt,
  ).run();
}

async function assignBoard(projectId: string, userId: string, boardId: string) {
  await env.DB.prepare(
    `INSERT INTO project_member_boards (project_id, user_id, board_id, assigned_by, assigned_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(projectId, userId, boardId, managerId, "2026-08-10T00:00:00.000Z").run();
}

beforeAll(async () => {
  const statements = [
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
    // 注意：不建立 0003 的 boards_one_active_per_project_unique——0005 已將其移除，
    // 本檔驗證的正是移除後可以有多個 active Board。
    "CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE UNIQUE INDEX IF NOT EXISTS board_access_board_name_unique ON boards(project_id, normalized_name) WHERE status = 'active'",
    "CREATE TABLE IF NOT EXISTS activity_logs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, board_id TEXT, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER, metadata TEXT NOT NULL, occurred_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT NOT NULL, legacy_project_id TEXT NOT NULL, legacy_board_id TEXT NOT NULL, locked_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, error TEXT)",
    // migration 0005：看板指派表。FK 對齊 project_members／boards／user_accounts。
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
    "CREATE INDEX IF NOT EXISTS project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  await env.DB.prepare("PRAGMA foreign_keys = ON").run();
  for (const table of [
    "project_member_boards", "activity_logs", "boards", "project_members", "projects",
    "workspace_members", "workspaces", "access_tokens", "user_accounts", "migration_state",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await insertUser(managerId, managerToken);
  await insertUser(contributorId, contributorToken);
  await insertUser(viewerId, viewerToken);
  const now = "2026-08-10T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', ?, ?)",
  ).bind(workspaceId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Alpha', 'alpha', 'active', ?, ?, ?)`,
  ).bind(projectA, workspaceId, managerId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'manager', ?, ?),
            (?, ?, 'contributor', ?, ?),
            (?, ?, 'viewer', ?, ?)`,
  ).bind(
    projectA, managerId, now, now,
    projectA, contributorId, now, now,
    projectA, viewerId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'complete', ?, ?, ?, ?)`,
  ).bind(workspaceId, projectA, boardA, now).run();
});

describe("multi-board creation (migration 0005)", () => {
  it("allows creating a second active Board in the same Project", async () => {
    const first = await createBoard(managerToken, projectA, boardA, "Board A");
    expect(first.status).toBe(201);
    const second = await createBoard(managerToken, projectA, boardB, "Board B");
    expect(second.status).toBe(201);

    const list = await dispatch(managerToken, `/projects/${projectA}/boards?status=active`);
    expect(list.status).toBe(200);
    const body = await list.json() as { boards: Array<{ id: string }> };
    expect(body.boards.map((entry) => entry.id).sort()).toEqual([boardA, boardB].sort());
  });
});

describe("resolveVisibleBoardIds", () => {
  it("falls back to the primary Board for a contributor without assignment rows", async () => {
    await insertBoard(boardA, projectA, "Older", "2026-08-01T00:00:00.000Z");
    await insertBoard(boardB, projectA, "Newer", "2026-08-05T00:00:00.000Z");

    const visible = await resolveVisibleBoardIds(env.DB, projectA, contributorId, contributorAccess);
    expect(visible).toEqual(new Set([boardB]));
  });

  it("uses the assignment set once assignment rows exist, overriding the fallback", async () => {
    await insertBoard(boardA, projectA, "Older", "2026-08-01T00:00:00.000Z");
    await insertBoard(boardB, projectA, "Newer", "2026-08-05T00:00:00.000Z");
    await assignBoard(projectA, contributorId, boardA);

    const visible = await resolveVisibleBoardIds(env.DB, projectA, contributorId, contributorAccess);
    expect(visible).toEqual(new Set([boardA]));
  });

  it("returns null (fully visible) for the owner and the legacy viewer regardless of assignment rows", async () => {
    await insertBoard(boardA, projectA, "Only Board", "2026-08-01T00:00:00.000Z");
    // 即使意外存在指派列，owner／viewer 仍必須全可見——證明兩者完全不查表。
    await assignBoard(projectA, managerId, boardA);

    expect(await resolveVisibleBoardIds(env.DB, projectA, managerId, managerAccess)).toBeNull();
    expect(await resolveVisibleBoardIds(env.DB, projectA, viewerId, viewerAccess)).toBeNull();
  });

  it("fails closed (empty set, not full visibility) for a null or unknown project role", async () => {
    await insertBoard(boardA, projectA, "Only Board", "2026-08-01T00:00:00.000Z");

    const nullRoleAccess: ProjectAccess = {
      workspaceRole: null,
      projectRole: null,
      projectStatus: "active",
    };
    expect(
      await resolveVisibleBoardIds(env.DB, projectA, contributorId, nullRoleAccess),
    ).toEqual(new Set());

    // 模擬「未知角色」字串意外流入（例如把 public role 誤當 stored role 傳入）：
    // 地基必須 fail-closed，不能落入舊的 `!== "contributor"` 全可見分支。
    const unknownRoleAccess: ProjectAccess = {
      workspaceRole: null,
      projectRole: "owner" as ProjectAccess["projectRole"],
      projectStatus: "active",
    };
    expect(
      await resolveVisibleBoardIds(env.DB, projectA, contributorId, unknownRoleAccess),
    ).toEqual(new Set());
  });
});

describe("requireBoardVisible", () => {
  it("rejects a non-visible Board with 404 not_found and allows the visible one", async () => {
    await insertBoard(boardA, projectA, "Older", "2026-08-01T00:00:00.000Z");
    await insertBoard(boardB, projectA, "Newer", "2026-08-05T00:00:00.000Z");

    await expect(
      requireBoardVisible(env.DB, projectA, boardA, contributorId, contributorAccess),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(
      requireBoardVisible(env.DB, projectA, boardB, contributorId, contributorAccess),
    ).resolves.toBeUndefined();
  });
});

describe("project_member_boards cascade", () => {
  it("clears assignment rows when project membership is removed", async () => {
    await insertBoard(boardA, projectA, "Only Board", "2026-08-01T00:00:00.000Z");
    await assignBoard(projectA, contributorId, boardA);

    await env.DB.prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
    ).bind(projectA, contributorId).run();

    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM project_member_boards WHERE project_id = ? AND user_id = ?",
    ).bind(projectA, contributorId).first<number>("count");
    expect(remaining).toBe(0);
  });
});
