import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authenticate } from "../src/auth";
import { writeAuditEvent } from "../src/audit";
import { authorizeProject } from "../src/authorization";
import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const managerToken = "manager-runtime-token-which-is-long-enough";
const viewerToken = "viewer-runtime-token-which-is-long-enough";
const adminToken = "admin-runtime-token-which-is-long-enough";
const projectId = "00000000-0000-4000-8000-000000000003";
const workspaceId = "00000000-0000-4000-8000-000000000001";

async function insertUser(id: string, token: string, status = "active") {
  const now = "2026-07-26T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, id, status, now, now).run();
  await env.DB.prepare(
    "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'test', ?, 'personal', ?)",
  ).bind(`${id}-token`, id, await sha256Hex(token), now).run();
}

beforeAll(async () => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_kind TEXT NOT NULL, legacy_user_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS activity_logs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, board_id TEXT, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER, metadata TEXT NOT NULL, occurred_at TEXT NOT NULL)",
  ).run();
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM activity_logs").run();
  await env.DB.prepare("DELETE FROM project_members").run();
  await env.DB.prepare("DELETE FROM projects").run();
  await env.DB.prepare("DELETE FROM workspace_members").run();
  await env.DB.prepare("DELETE FROM workspaces").run();
  await env.DB.prepare("DELETE FROM access_tokens").run();
  await env.DB.prepare("DELETE FROM user_accounts").run();
  await insertUser("manager-user", managerToken);
  await insertUser("viewer-user", viewerToken);
  await insertUser("admin-user", adminToken);
  const now = "2026-07-26T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', ?, ?)",
  ).bind(workspaceId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO projects (id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at) VALUES (?, ?, 'Project', 'project', 'active', 'manager-user', ?, ?)",
  ).bind(projectId, workspaceId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO project_members (project_id, user_id, role, created_at, updated_at) VALUES (?, 'manager-user', 'manager', ?, ?), (?, 'viewer-user', 'viewer', ?, ?)",
  ).bind(projectId, now, now, projectId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at) VALUES (?, 'admin-user', 'admin', ?, ?)",
  ).bind(workspaceId, now, now).run();
});

describe("Worker identity and authorization", () => {
  it("maps a personal token to the correct active user", async () => {
    const request = new Request("https://sync.test/board", {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    await expect(authenticate(request, env.DB)).resolves.toMatchObject({
      id: "manager-user",
      displayName: "manager-user",
    });
  });

  it("rejects revoked tokens and disabled users", async () => {
    await env.DB.prepare("UPDATE access_tokens SET revoked_at = ? WHERE user_id = 'manager-user'")
      .bind("2026-07-26T01:00:00.000Z").run();
    const managerRequest = new Request("https://sync.test/board", {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    await expect(authenticate(managerRequest, env.DB)).resolves.toBeNull();

    await env.DB.prepare("UPDATE user_accounts SET status = 'disabled' WHERE id = 'viewer-user'").run();
    const viewerRequest = new Request("https://sync.test/board", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    await expect(authenticate(viewerRequest, env.DB)).resolves.toBeNull();
  });

  it("returns 404 without membership and 403 when the role is insufficient", async () => {
    await expect(authorizeProject(env.DB, "admin-user", projectId, "read"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(authorizeProject(env.DB, "viewer-user", projectId, "edit"))
      .rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(authorizeProject(env.DB, "manager-user", projectId, "manage"))
      .resolves.toMatchObject({ projectRole: "manager" });
  });

  it("writes audit identity from the authenticated server-side actor", async () => {
    await writeAuditEvent(env.DB, {
      id: "audit-runtime-id",
      workspaceId,
      projectId,
      boardId: null,
      actorUserId: "manager-user",
      action: "project.created",
      entityType: "project",
      entityId: projectId,
      revision: null,
      metadata: { source: "runtime-test" },
      occurredAt: "2026-07-26T00:00:00.000Z",
    });
    await expect(
      env.DB.prepare("SELECT actor_user_id, metadata FROM activity_logs WHERE id = ?")
        .bind("audit-runtime-id").first(),
    ).resolves.toMatchObject({
      actor_user_id: "manager-user",
      metadata: '{"source":"runtime-test"}',
    });
  });
});
