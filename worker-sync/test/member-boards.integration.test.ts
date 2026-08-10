import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "b1000000-0000-4000-8000-000000000001";
const managerId = "b1000000-0000-4000-8000-000000000002";
const contributorId = "b1000000-0000-4000-8000-000000000003";
const outsiderId = "b1000000-0000-4000-8000-000000000004";
const projectA = "c1000000-0000-4000-8000-000000000001";
const projectB = "c1000000-0000-4000-8000-000000000002";
const boardA = "d1000000-0000-4000-8000-000000000001";
const boardB = "d1000000-0000-4000-8000-000000000002";
const boardOtherProject = "d1000000-0000-4000-8000-000000000003";
const managerToken = "member-boards-manager-runtime-token-long-value";
const contributorToken = "member-boards-contributor-runtime-token-long-value";
const outsiderToken = "member-boards-outsider-runtime-token-long-value";

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

/** 直接寫入 boards row，跳過 API，以便精準控制 updated_at 來決定 primary board
 *（沿用 board-access.integration.test.ts 的既有慣例）。名稱刻意取獨特字串，
 *  用於驗證 audit metadata 不洩漏看板名稱。 */
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
    JSON.stringify({ version: 3, columns: [], cards: {}, marker: name }),
    managerId,
    updatedAt,
    updatedAt,
  ).run();
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
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT NOT NULL, legacy_project_id TEXT NOT NULL, legacy_board_id TEXT NOT NULL, locked_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, error TEXT)",
    // migration 0005：看板指派表。DDL 與 worker-sync/migrations/0005_multi_board_assignments.sql 逐字一致（含 FK）。
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
    "CREATE INDEX IF NOT EXISTS member_boards_project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
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
  await insertUser(outsiderId, outsiderToken);
  const now = "2026-08-10T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', ?, ?)",
  ).bind(workspaceId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Alpha', 'alpha', 'active', ?, ?, ?),
              (?, ?, 'Beta', 'beta', 'active', ?, ?, ?)`,
  ).bind(
    projectA, workspaceId, managerId, now, now,
    projectB, workspaceId, managerId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'manager', ?, ?),
            (?, ?, 'contributor', ?, ?)`,
  ).bind(
    projectA, managerId, now, now,
    projectA, contributorId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'complete', ?, ?, ?, ?)`,
  ).bind(workspaceId, projectA, boardA, now).run();
  // boardB 刻意較新，作為無指派列 contributor 的 fallback 主要看板。
  await insertBoard(boardA, projectA, "Board Alpha Confidential Name", "2026-08-10T00:00:00.000Z");
  await insertBoard(boardB, projectA, "Board Beta Fallback Name", "2026-08-10T01:00:00.000Z");
  await insertBoard(boardOtherProject, projectB, "Other Project Board", "2026-08-10T00:00:00.000Z");
});

describe("owner-only board assignment API", () => {
  it("lets an owner assign a board and read the assignment back", async () => {
    const put = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardA] }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ boardIds: [boardA] });

    const get = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`);
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ boardIds: [boardA] });
  });

  it("makes the assignment take effect on board visibility (Task 2 enforcement)", async () => {
    const put = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardA] }),
    });
    expect(put.status).toBe(200);

    const visible = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}`);
    expect(visible.status).toBe(200);
    const hidden = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardB}`);
    expect(hidden.status).toBe(404);
  });

  it("clearing the assignment list returns [] and falls back to the primary board", async () => {
    await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardA] }),
    });

    const clear = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [] }),
    });
    expect(clear.status).toBe(200);
    expect(await clear.json()).toMatchObject({ boardIds: [] });

    // boardB 是全專案最新的 active 看板，contributor 無指派列時應 fallback 到它。
    const fallback = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardB}`);
    expect(fallback.status).toBe(200);
  });

  it("is idempotent across repeated identical PUTs", async () => {
    const body = JSON.stringify({ boardIds: [boardA, boardB] });
    const first = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body,
    });
    const second = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as { boardIds: string[] };
    const secondBody = await second.json() as { boardIds: string[] };
    expect(firstBody.boardIds).toEqual([boardA, boardB]);
    expect(secondBody.boardIds).toEqual([boardA, boardB]);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_member_boards WHERE project_id = ? AND user_id = ?",
      ).bind(projectA, contributorId).first<number>("count"),
    ).toBe(2);
  });

  it("blocks a contributor from reading or assigning boards (owner-only)", async () => {
    const put = await dispatch(contributorToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardA] }),
    });
    expect(put.status).toBe(403);
    expect(await put.json()).toMatchObject({ error: "forbidden" });

    const get = await dispatch(contributorToken, `/projects/${projectA}/members/${contributorId}/boards`);
    expect(get.status).toBe(403);
  });

  it("rejects board ids that do not exist or belong to another project", async () => {
    const nonexistent = "d1000000-0000-4000-8000-000000000099";
    const missing = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [nonexistent] }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "invalid_board_ids" });

    const crossProject = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardOtherProject] }),
    });
    expect(crossProject.status).toBe(400);
    expect(await crossProject.json()).toMatchObject({ error: "invalid_board_ids" });
  });

  it("rejects more than the maximum number of assigned boards", async () => {
    const tooMany = Array.from(
      { length: 51 },
      (_, index) => `d2000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const response = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: tooMany }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_board_ids" });
  });

  it("rejects a target user who is not a member of the project", async () => {
    const put = await dispatch(managerToken, `/projects/${projectA}/members/${outsiderId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardA] }),
    });
    expect(put.status).toBe(404);
    expect(await put.json()).toMatchObject({ error: "user_not_found" });

    const get = await dispatch(managerToken, `/projects/${projectA}/members/${outsiderId}/boards`);
    expect(get.status).toBe(404);
    expect(await get.json()).toMatchObject({ error: "user_not_found" });
  });

  it("writes a member.boards_assigned audit event without leaking board names", async () => {
    const response = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [boardA] }),
    });
    expect(response.status).toBe(200);

    const log = await env.DB.prepare(
      `SELECT action, entity_type, entity_id, metadata FROM activity_logs
       WHERE project_id = ? AND action = 'member.boards_assigned'
       ORDER BY occurred_at DESC LIMIT 1`,
    ).bind(projectA).first<{
      action: string; entity_type: string; entity_id: string; metadata: string;
    }>();
    expect(log).toMatchObject({
      action: "member.boards_assigned",
      entity_type: "membership",
      entity_id: contributorId,
    });
    const metadata = JSON.parse(log!.metadata) as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(["boardIds", "userId"]);
    expect(metadata).toMatchObject({ userId: contributorId, boardIds: [boardA] });
    // 明確斷言 metadata 原始字串不含看板名稱——即使未來新增欄位夾帶名稱字串也會被抓到。
    expect(log!.metadata).not.toContain("Board Alpha Confidential Name");
    expect(log!.metadata).not.toContain("Board Beta Fallback Name");
  });

  it("[audit gate] documents whether a vacuous clear (already empty) still writes an audit event", async () => {
    // contributor 在此測試中從未被指派過任何看板：DELETE 之前 project_member_boards
    // 沒有任何列可刪，batch 是 [DELETE(0 rows), audit WHERE changes()>0]。
    // 這一項驗證 requireChanges 閘門在「純 DELETE 且無變更」下的實際行為，並把觀察到的
    // 結果釘進測試——供 task-5-report.md 引用說明。
    const response = await dispatch(managerToken, `/projects/${projectA}/members/${contributorId}/boards`, {
      method: "PUT",
      body: JSON.stringify({ boardIds: [] }),
    });
    expect(response.status).toBe(200);
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM activity_logs
       WHERE project_id = ? AND entity_id = ? AND action = 'member.boards_assigned'`,
    ).bind(projectA, contributorId).first<number>("count");
    expect(count).toBe(0);
  });
});
