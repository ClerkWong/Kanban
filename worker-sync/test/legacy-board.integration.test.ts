import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_ID,
  LEGACY_BOARD_ID,
  LEGACY_PROJECT_ID,
} from "../src/db-types";
import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const memberId = "60000000-0000-4000-8000-000000000001";
const outsiderId = "60000000-0000-4000-8000-000000000002";
const memberToken = "task6-legacy-member-token-long-value";
const outsiderToken = "task6-legacy-outsider-token-long-value";

function board(marker: string): Record<string, unknown> {
  return { version: 3, columns: [], cards: {}, marker };
}

async function dispatch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return exports.default.fetch(new Request(`${endpoint}${path}`, { ...init, headers }));
}

async function insertUser(id: string, token: string) {
  const now = "2026-07-27T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  ).bind(id, id, now, now).run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'legacy-test', ?, 'personal', ?)",
  ).bind(`${id}-token`, id, await sha256Hex(token), now).run();
}

beforeAll(async () => {
  const statements = [
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
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "activity_logs", "boards", "board", "project_members", "projects", "workspace_members",
    "workspaces", "access_tokens", "user_accounts", "migration_state",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await insertUser(memberId, memberToken);
  await insertUser(outsiderId, outsiderToken);
  const now = "2026-07-27T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Legacy Workspace', ?, ?)",
  ).bind(DEFAULT_WORKSPACE_ID, now, now).run();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Legacy Project', 'legacy project', 'active', ?, ?, ?)`,
  ).bind(LEGACY_PROJECT_ID, DEFAULT_WORKSPACE_ID, memberId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO project_members (project_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'manager', ?, ?)",
  ).bind(LEGACY_PROJECT_ID, memberId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at
     ) VALUES (?, ?, 'Legacy Board', 'legacy board', 'active', 7, ?, ?, ?, ?)`,
  ).bind(
    LEGACY_BOARD_ID,
    LEGACY_PROJECT_ID,
    JSON.stringify(board("new-authority")),
    memberId,
    now,
    now,
  ).run();
  await env.DB.prepare(
    "INSERT INTO board (id, revision, data, updated_at) VALUES (1, 7, ?, ?)",
  ).bind(JSON.stringify(board("legacy-authority")), now).run();
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'pending', ?, ?, ?, ?)`,
  ).bind(DEFAULT_WORKSPACE_ID, LEGACY_PROJECT_ID, LEGACY_BOARD_ID, now).run();
});

describe("Legacy /board alias", () => {
  it("uses only the legacy row while migration is pending", async () => {
    const get = await dispatch(memberToken, "/board");
    expect(await get.json()).toMatchObject({
      revision: 7,
      board: { marker: "legacy-authority" },
    });

    const put = await dispatch(memberToken, "/board", {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 7, board: board("pending-write") }),
    });
    expect(put.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT revision FROM board WHERE id = 1")
        .first<number>("revision"),
    ).toBe(8);
    expect(
      await env.DB.prepare("SELECT revision FROM boards WHERE id = ?")
        .bind(LEGACY_BOARD_ID).first<number>("revision"),
    ).toBe(7);
  });

  it("keeps GET on the legacy authority and blocks PUT while locked", async () => {
    await env.DB.prepare("UPDATE migration_state SET status = 'locked' WHERE id = 1").run();
    const get = await dispatch(memberToken, "/board");
    expect(await get.json()).toMatchObject({ board: { marker: "legacy-authority" } });

    const put = await dispatch(memberToken, "/board", {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 7, board: board("blocked") }),
    });
    expect(put.status).toBe(503);
    expect(await put.json()).toMatchObject({ error: "migration_locked" });
    expect(
      await env.DB.prepare("SELECT revision FROM board WHERE id = 1")
        .first<number>("revision"),
    ).toBe(7);
  });

  it("switches atomically to the same v2 row used by the nested endpoint after completion", async () => {
    await env.DB.prepare("UPDATE migration_state SET status = 'complete' WHERE id = 1").run();
    const get = await dispatch(memberToken, "/board");
    expect(await get.json()).toMatchObject({
      revision: 7,
      board: { marker: "new-authority" },
    });

    const put = await dispatch(memberToken, "/board", {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 7, board: board("alias-write") }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ revision: 8 });
    expect(
      await env.DB.prepare("SELECT revision FROM board WHERE id = 1")
        .first<number>("revision"),
    ).toBe(7);

    const nested = await dispatch(
      memberToken,
      `/projects/${LEGACY_PROJECT_ID}/boards/${LEGACY_BOARD_ID}`,
    );
    expect(await nested.json()).toMatchObject({
      board: {
        content: { revision: 8, board: { marker: "alias-write" } },
      },
    });
  });

  it("requires Project membership after the alias switches to v2", async () => {
    await env.DB.prepare("UPDATE migration_state SET status = 'complete' WHERE id = 1").run();
    expect((await dispatch(outsiderToken, "/board")).status).toBe(404);
  });
});
