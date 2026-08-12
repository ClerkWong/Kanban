import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resolveCalendarScope } from "../src/calendar";

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

beforeAll(async () => {
  const statements = [
    "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'archived')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('manager', 'contributor', 'viewer')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))",
    "CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'archived')), revision INTEGER NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, archived_by TEXT)",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const table of [
    "boards", "project_members", "projects", "workspace_members", "workspaces", "user_accounts",
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

    const scope = await resolveCalendarScope(env.DB, memberManagerId, workspaceA);
    expect(scope).toEqual({ kind: "owned_projects", projectIds: [projectOwnedByManager] });
  });

  it("rejects a plain member who is only a contributor with 403 forbidden", async () => {
    await insertWorkspaceMember(workspaceA, memberContributorId, "member");
    await insertProject(projectContributorHome, workspaceA, "Contributor Home", otherOwnerId);
    await insertProjectMember(projectContributorHome, memberContributorId, "contributor");

    await expect(resolveCalendarScope(env.DB, memberContributorId, workspaceA))
      .rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("rejects a non-member of the workspace with 404 not_found", async () => {
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
