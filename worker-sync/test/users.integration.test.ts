import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "../src/passwords";
import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "71000000-0000-4000-8000-000000000001";
const ownerId = "71000000-0000-4000-8000-000000000002";
const ownerToken = "user-admin-owner-token-long-enough-value";
const ownerEmail = "owner@example.com";
const ownerPassword = "owner-password-2026";
const memberId = "71000000-0000-4000-8000-000000000003";
const memberToken = "user-admin-member-token-long-enough-value";
const targetUserId = "71000000-0000-4000-8000-000000000004";
const projectA = "71000000-0000-4000-8000-000000000005";
const projectB = "71000000-0000-4000-8000-000000000006";
const outsiderUserId = "71000000-0000-4000-8000-000000000099";

async function dispatch(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return exports.default.fetch(new Request(`${endpoint}${path}`, { ...init, headers }));
}

beforeAll(async () => {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, email TEXT, normalized_email TEXT)",
    "CREATE UNIQUE INDEX IF NOT EXISTS test_users_email_unique ON user_accounts(normalized_email) WHERE normalized_email IS NOT NULL",
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS password_credentials (user_id TEXT PRIMARY KEY, algorithm TEXT NOT NULL, iterations INTEGER NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
    "CREATE TABLE IF NOT EXISTS login_attempts (attempt_key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL, window_started_at TEXT NOT NULL, blocked_until TEXT, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('manager', 'contributor', 'viewer')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
    "CREATE TABLE IF NOT EXISTS workspace_activity_logs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, target_user_id TEXT, metadata TEXT NOT NULL, occurred_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
  ]) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "workspace_activity_logs", "project_members", "projects", "workspace_members", "workspaces",
    "login_attempts", "user_sessions", "password_credentials", "access_tokens",
    "user_accounts", "migration_state",
  ]) await env.DB.prepare(`DELETE FROM ${table}`).run();

  const now = "2026-08-04T00:00:00.000Z";
  const credential = await hashPassword(ownerPassword);
  await env.DB.prepare(
    `INSERT INTO user_accounts (
       id, display_name, status, created_at, updated_at, email, normalized_email
     ) VALUES (?, 'Owner', 'active', ?, ?, ?, ?)`,
  ).bind(ownerId, now, now, ownerEmail, ownerEmail).run();
  await env.DB.prepare(
    `INSERT INTO password_credentials (
       user_id, algorithm, iterations, salt, password_hash, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    ownerId,
    credential.algorithm,
    credential.iterations,
    credential.salt,
    credential.passwordHash,
    now,
  ).run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'owner', ?, 'personal', ?)",
  ).bind(crypto.randomUUID(), ownerId, await sha256Hex(ownerToken), now).run();
  await env.DB.prepare("INSERT INTO workspaces VALUES (?, 'Workspace', ?, ?)")
    .bind(workspaceId, now, now).run();
  await env.DB.prepare("INSERT INTO workspace_members VALUES (?, ?, 'owner', ?, ?)")
    .bind(workspaceId, ownerId, now, now).run();
  await env.DB.prepare("INSERT INTO migration_state (id, status) VALUES (1, 'complete')").run();

  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, 'Member', 'active', ?, ?)",
  ).bind(memberId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'member', ?, 'personal', ?)",
  ).bind(crypto.randomUUID(), memberId, await sha256Hex(memberToken), now).run();
  await env.DB.prepare("INSERT INTO workspace_members VALUES (?, ?, 'member', ?, ?)")
    .bind(workspaceId, memberId, now, now).run();

  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, 'Target', 'active', ?, ?)",
  ).bind(targetUserId, now, now).run();
  await env.DB.prepare("INSERT INTO workspace_members VALUES (?, ?, 'member', ?, ?)")
    .bind(workspaceId, targetUserId, now, now).run();

  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Alpha', 'alpha', 'active', ?, ?, ?),
              (?, ?, 'Archived Co', 'archived co', 'archived', ?, ?, ?)`,
  ).bind(
    projectA, workspaceId, ownerId, now, now,
    projectB, workspaceId, ownerId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'manager', ?, ?), (?, ?, 'contributor', ?, ?)`,
  ).bind(
    projectA, targetUserId, now, now,
    projectB, targetUserId, now, now,
  ).run();
});

describe("password login and user administration", () => {
  it("creates a revocable session without returning a personal token", async () => {
    const login = await dispatch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    });
    expect(login.status).toBe(200);
    const loginBody = await login.json() as { token: string };
    expect(loginBody.token).toMatch(/^kbs_[A-Za-z0-9_-]{40,}$/);
    expect(loginBody.token).not.toBe(ownerToken);

    const me = await dispatch("/me", {}, loginBody.token);
    expect(await me.json()).toMatchObject({
      user: { id: ownerId, tokenKind: "session" },
      workspaces: [{ workspaceId, role: "owner" }],
    });
    expect((await dispatch("/auth/logout", { method: "POST" }, loginBody.token)).status).toBe(200);
    expect((await dispatch("/me", {}, loginBody.token)).status).toBe(401);
  });

  it("lets an owner create, list, and disable a login account", async () => {
    const email = "member@example.com";
    const password = "member-password-2026";
    const created = await dispatch("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        workspaceId,
        displayName: "Member",
        email,
        password,
        workspaceRole: "member",
      }),
    }, ownerToken);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { user: { id: string } };

    const list = await dispatch(`/admin/users?workspaceId=${workspaceId}`, {}, ownerToken);
    expect(await list.json()).toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({ email, workspaceRole: "member", hasPassword: true }),
      ]),
    });

    const login = await dispatch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const session = await login.json() as { token: string };
    expect(login.status).toBe(200);

    const disabled = await dispatch(
      `/admin/users/${createdBody.user.id}?workspaceId=${workspaceId}`,
      { method: "PATCH", body: JSON.stringify({ status: "disabled" }) },
      ownerToken,
    );
    expect(disabled.status).toBe(200);
    expect((await dispatch("/me", {}, session.token)).status).toBe(401);
    expect((await dispatch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })).status).toBe(401);
  });
});

describe("GET /admin/users/:userId/projects", () => {
  it("returns the user's active project memberships with public role names", async () => {
    const response = await dispatch(
      `/admin/users/${targetUserId}/projects?workspaceId=${workspaceId}`,
      {},
      ownerToken,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: targetUserId,
      memberships: expect.arrayContaining([
        expect.objectContaining({
          projectId: projectA,
          projectName: "Alpha",
          role: "owner",
          status: "active",
        }),
      ]),
    });
  });

  it("includes archived project memberships with status archived", async () => {
    const response = await dispatch(
      `/admin/users/${targetUserId}/projects?workspaceId=${workspaceId}`,
      {},
      ownerToken,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      memberships: expect.arrayContaining([
        expect.objectContaining({
          projectId: projectB,
          projectName: "Archived Co",
          role: "member",
          status: "archived",
        }),
      ]),
    });
  });

  it("returns 404 when the caller is not a workspace admin", async () => {
    const response = await dispatch(
      `/admin/users/${targetUserId}/projects?workspaceId=${workspaceId}`,
      {},
      memberToken,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  it("returns 404 user_not_found when the target user is not in the workspace", async () => {
    const response = await dispatch(
      `/admin/users/${outsiderUserId}/projects?workspaceId=${workspaceId}`,
      {},
      ownerToken,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "user_not_found" });
  });

  it("returns an empty array when the user has no project memberships", async () => {
    const response = await dispatch(
      `/admin/users/${memberId}/projects?workspaceId=${workspaceId}`,
      {},
      ownerToken,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userId: memberId, memberships: [] });
  });
});
