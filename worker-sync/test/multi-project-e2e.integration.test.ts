import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "90000000-0000-4000-8000-000000000001";
const projectId = "90000000-0000-4000-8000-000000000002";
const boardA = "90000000-0000-4000-8000-000000000003";
const boardB = "90000000-0000-4000-8000-000000000004";
const managerId = "90000000-0000-4000-8000-000000000005";
const contributorId = "90000000-0000-4000-8000-000000000006";
const viewerId = "90000000-0000-4000-8000-000000000007";
const outsiderId = "90000000-0000-4000-8000-000000000008";
const tokens = {
  manager: "e2e-manager-token-long-enough-value",
  contributor: "e2e-contributor-token-long-enough-value",
  viewer: "e2e-viewer-token-long-enough-value",
  outsider: "e2e-outsider-token-long-enough-value",
};

function board(marker: string) {
  return { version: 4, columns: [], cards: {}, labels: [], deletedCards: {}, lastSavedAt: "2026-07-27T00:00:00.000Z", marker };
}

async function dispatch(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return exports.default.fetch(new Request(`${endpoint}${path}`, { ...init, headers }));
}

beforeAll(async () => {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
    "CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS activity_logs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, board_id TEXT, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER, metadata TEXT NOT NULL, occurred_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT NOT NULL, legacy_project_id TEXT NOT NULL, legacy_board_id TEXT NOT NULL, locked_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, error TEXT)",
    // migration 0005：看板指派表。Task 2 起 board-access.ts 的 resolveVisibleBoardIds
    // 會查詢此表，即使本檔沒有測試指派情境，缺了這張表 contributor 的請求就會 500。
    "CREATE TABLE IF NOT EXISTS project_member_boards (project_id TEXT NOT NULL, user_id TEXT NOT NULL, board_id TEXT NOT NULL, assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id, board_id))",
  ]) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of ["project_member_boards", "activity_logs", "boards", "board", "project_members", "projects", "workspace_members", "workspaces", "access_tokens", "user_accounts", "migration_state"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const now = "2026-07-27T00:00:00.000Z";
  const users = [[managerId, tokens.manager], [contributorId, tokens.contributor], [viewerId, tokens.viewer], [outsiderId, tokens.outsider]];
  for (const [id, token] of users) {
    await env.DB.prepare("INSERT INTO user_accounts VALUES (?, ?, 'active', ?, ?)").bind(id, id, now, now).run();
    await env.DB.prepare("INSERT INTO access_tokens (id,user_id,label,token_hash,token_kind,created_at) VALUES (?,?, 'e2e',?,'personal',?)").bind(`${id}-token`, id, await sha256Hex(token), now).run();
  }
  await env.DB.prepare("INSERT INTO workspaces VALUES (?, 'E2E', ?, ?)").bind(workspaceId, now, now).run();
  await env.DB.prepare("INSERT INTO workspace_members VALUES (?, ?, 'owner', ?, ?)").bind(workspaceId, managerId, now, now).run();
  await env.DB.prepare("INSERT INTO projects VALUES (?,?,'E2E','e2e','active',?,?,?,NULL,NULL)").bind(projectId, workspaceId, managerId, now, now).run();
  for (const [id, role] of [[managerId, "manager"], [contributorId, "contributor"], [viewerId, "viewer"]]) {
    await env.DB.prepare("INSERT INTO project_members VALUES (?,?,?,?,?)").bind(projectId, id, role, now, now).run();
  }
  await env.DB.prepare("INSERT INTO boards VALUES (?,?,?,?,'active',1,?,?,?, ?,NULL,NULL)")
    .bind(boardA, projectId, "A", "a", JSON.stringify(board("a")), managerId, now, now).run();
  await env.DB.prepare("INSERT INTO boards VALUES (?,?,?,?,'archived',1,?,?,?,?,?,?)")
    .bind(boardB, projectId, "B", "b", JSON.stringify(board("b")), managerId, now, now, now, managerId).run();
  await env.DB.prepare("INSERT INTO migration_state (id,status,default_workspace_id,legacy_project_id,legacy_board_id,completed_at,updated_at) VALUES (1,'complete',?,?,?,?,?)")
    .bind(workspaceId, projectId, boardA, now, now).run();
});

describe("multi-project cutover e2e", () => {
  it("enforces roles, board isolation, archive read-only, and a single legacy alias authority", async () => {
    expect((await dispatch(tokens.outsider, `/projects/${projectId}/boards/${boardA}`)).status).toBe(404);
    expect((await dispatch(tokens.viewer, `/projects/${projectId}/boards/${boardA}/content`, {
      method: "PUT", body: JSON.stringify({ baseRevision: 1, board: board("viewer") }),
    })).status).toBe(403);
    expect((await dispatch(tokens.contributor, `/projects/${projectId}/boards/${boardA}/content`, {
      method: "PUT", body: JSON.stringify({ baseRevision: 1, board: board("updated-a") }),
    })).status).toBe(200);
    expect(await (await dispatch(tokens.manager, `/projects/${projectId}/boards/${boardB}`)).json()).toMatchObject({
      board: { content: { revision: 1, board: { marker: "b" } } },
    });
    expect(await (await dispatch(tokens.manager, "/board")).json()).toMatchObject({
      revision: 2, board: { marker: "updated-a" },
    });
    const archive = await dispatch(tokens.manager, `/projects/${projectId}/boards/${boardA}/archive`, { method: "POST" });
    expect(archive.status).toBe(409);
    expect(await archive.json()).toMatchObject({ error: "single_board_required" });
    expect((await dispatch(tokens.manager, `/projects/${projectId}/archive`, { method: "POST" })).status).toBe(200);
    const blocked = await dispatch(tokens.contributor, `/projects/${projectId}/boards/${boardA}/content`, {
      method: "PUT", body: JSON.stringify({ baseRevision: 2, board: board("offline-pending") }),
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "resource_archived" });
  });
});
