import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const managerId = "10000000-0000-4000-8000-000000000002";
const viewerId = "10000000-0000-4000-8000-000000000003";
const outsiderId = "10000000-0000-4000-8000-000000000004";
const secondManagerId = "10000000-0000-4000-8000-000000000005";
const projectA = "20000000-0000-4000-8000-000000000001";
const projectB = "20000000-0000-4000-8000-000000000002";
const managerToken = "task5-manager-runtime-token-long-value";
const viewerToken = "task5-viewer-runtime-token-long-value";
const outsiderToken = "task5-outsider-runtime-token-long-value";

async function dispatch(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return exports.default.fetch(new Request(`${endpoint}${path}`, { ...init, headers }));
}

async function insertUser(id: string, token: string) {
  const now = "2026-07-26T00:00:00.000Z";
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
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS task5_project_name_unique ON projects(workspace_id, normalized_name) WHERE status = 'active'",
    // migration 0005：看板指派表（listProjects 透過 board-access.ts 的
    // resolveVisibleBoardIds 查詢此表，修正 contributor 的代表看板欄位）。
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
    "CREATE INDEX IF NOT EXISTS task4b_project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
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
  await insertUser(managerId, managerToken);
  await insertUser(viewerId, viewerToken);
  await insertUser(outsiderId, outsiderToken);
  await insertUser(secondManagerId, "second-manager-token-long-value-1234");
  const now = "2026-07-26T00:00:00.000Z";
  await env.DB.prepare("INSERT INTO migration_state (id, status) VALUES (1, 'complete')").run();
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', ?, ?)",
  ).bind(workspaceId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?)",
  ).bind(workspaceId, managerId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
  ).bind(workspaceId, secondManagerId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Alpha', 'alpha', 'active', ?, ?, ?),
              (?, ?, 'Private', 'private', 'active', ?, ?, ?)`,
  ).bind(projectA, workspaceId, managerId, now, now, projectB, workspaceId, outsiderId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'manager', ?, ?), (?, ?, 'viewer', ?, ?), (?, ?, 'manager', ?, ?)`,
  ).bind(
    projectA, managerId, now, now,
    projectA, viewerId, now, now,
    projectB, outsiderId, now, now,
  ).run();
});

describe("Project and membership APIs", () => {
  it("lists only caller memberships and hides guessed projects", async () => {
    const response = await dispatch(managerToken, "/projects");
    expect(response.status).toBe(200);
    const body = await response.json() as { projects: Array<{ id: string }> };
    expect(body.projects.map((project) => project.id)).toEqual([projectA]);
    expect((await dispatch(managerToken, `/projects/${projectB}`)).status).toBe(404);
  });

  it("supports different roles in different projects for the same user", async () => {
    const now = "2026-07-26T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO project_members (project_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'contributor', ?, ?)",
    ).bind(projectB, viewerId, now, now).run();
    const response = await dispatch(viewerToken, "/projects");
    const body = await response.json() as {
      projects: Array<{ id: string; myRole: string }>;
    };
    expect(new Map(body.projects.map((row) => [row.id, row.myRole]))).toEqual(
      new Map([[projectA, "viewer"], [projectB, "member"]]),
    );
  });

  it("scopes listProjects' representative board to what each contributor can see, leaving owner/viewer untouched", async () => {
    const boardOld = "20000000-0000-4000-8000-000000000030";
    const boardNew = "20000000-0000-4000-8000-000000000031";
    const contributorAssignedId = "10000000-0000-4000-8000-000000000006";
    const contributorFallbackId = "10000000-0000-4000-8000-000000000007";
    const contributorAssignedToken = "task5-contributor-assigned-runtime-token-long-value";
    const contributorFallbackToken = "task5-contributor-fallback-runtime-token-long-value";
    await insertUser(contributorAssignedId, contributorAssignedToken);
    await insertUser(contributorFallbackId, contributorFallbackToken);

    const olderUpdatedAt = "2026-07-26T00:00:00.000Z";
    const newerUpdatedAt = "2026-07-26T01:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO boards (
         id, project_id, name, normalized_name, status, revision, data,
         created_by, created_at, updated_at, archived_at, archived_by
       ) VALUES (?, ?, 'Board Old', 'board-old', 'active', 1, '{}', ?, ?, ?, NULL, NULL),
                (?, ?, 'Board New', 'board-new', 'active', 1, '{}', ?, ?, ?, NULL, NULL)`,
    ).bind(
      boardOld, projectA, managerId, olderUpdatedAt, olderUpdatedAt,
      boardNew, projectA, managerId, newerUpdatedAt, newerUpdatedAt,
    ).run();
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'contributor', ?, ?), (?, ?, 'contributor', ?, ?)`,
    ).bind(
      projectA, contributorAssignedId, newerUpdatedAt, newerUpdatedAt,
      projectA, contributorFallbackId, newerUpdatedAt, newerUpdatedAt,
    ).run();
    // 只指派 boardOld——刻意不是 listProjects 原本挑出的「全專案最新看板」boardNew。
    await env.DB.prepare(
      `INSERT INTO project_member_boards (project_id, user_id, board_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectA, contributorAssignedId, boardOld, managerId, newerUpdatedAt).run();

    type ListProjectsBody = {
      projects: Array<{ id: string; boardId: string | null; boardName: string | null }>;
    };
    const findProjectA = (body: ListProjectsBody) =>
      body.projects.find((row) => row.id === projectA);

    // owner／viewer：與修改前完全一致——代表看板恆是全專案最新的 boardNew。
    const managerBody = await (await dispatch(managerToken, "/projects")).json() as ListProjectsBody;
    expect(findProjectA(managerBody)).toMatchObject({ boardId: boardNew, boardName: "Board New" });

    const viewerBody = await (await dispatch(viewerToken, "/projects")).json() as ListProjectsBody;
    expect(findProjectA(viewerBody)).toMatchObject({ boardId: boardNew, boardName: "Board New" });

    // 有指派列的 contributor：代表看板是他被指派的 boardOld，且整份回應完全不含
    // 他看不到的 boardNew 名稱字串。
    const assignedRawText = await (await dispatch(contributorAssignedToken, "/projects")).text();
    expect(assignedRawText).not.toContain("Board New");
    const assignedBody = JSON.parse(assignedRawText) as ListProjectsBody;
    expect(findProjectA(assignedBody)).toMatchObject({ boardId: boardOld, boardName: "Board Old" });

    // 無指派列的 contributor：fallback 到主要看板，即全專案最新的 boardNew。
    const fallbackBody = await (await dispatch(contributorFallbackToken, "/projects")).json() as ListProjectsBody;
    expect(findProjectA(fallbackBody)).toMatchObject({ boardId: boardNew, boardName: "Board New" });
  });

  it("returns identity and an admin registry without project content", async () => {
    const me = await dispatch(managerToken, "/me");
    expect(await me.json()).toMatchObject({
      user: { id: managerId, tokenKind: "personal" },
      workspaces: [{ workspaceId, role: "admin" }],
    });
    const registry = await dispatch(managerToken, "/admin/projects");
    expect(registry.status).toBe(200);
    const body = await registry.json() as { projects: Array<Record<string, unknown>> };
    expect(body.projects.map((row) => row.id).sort()).toEqual([projectA, projectB]);
    expect(body.projects.every((row) => row.workspaceId === workspaceId)).toBe(true);
    expect(body.projects.every((row) => !("boards" in row) && !("activeBoardCount" in row))).toBe(true);
  });

  it("lets platform admins archive metadata without gaining Project content access", async () => {
    expect((await dispatch(managerToken, `/admin/projects/${projectB}/archive`, {
      method: "POST",
    })).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT status FROM projects WHERE id = ?")
        .bind(projectB).first<string>("status"),
    ).toBe("archived");
    expect((await dispatch(managerToken, `/projects/${projectB}`)).status).toBe(404);
    expect((await dispatch(managerToken, `/admin/projects/${projectB}/restore`, {
      method: "POST",
    })).status).toBe(200);
  });

  it("validates a personal replacement before revoking a shared legacy token", async () => {
    const legacyUserId = "20000000-0000-4000-8000-000000000099";
    const legacyToken = "legacy-shared-token-that-is-long-enough";
    const now = "2026-07-27T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO user_accounts (id, display_name, status, created_at, updated_at) VALUES (?, 'Legacy', 'active', ?, ?)",
    ).bind(legacyUserId, now, now).run();
    await env.DB.prepare(
      "INSERT INTO access_tokens (id, user_id, label, token_hash, token_kind, created_at) VALUES (?, ?, 'legacy', ?, 'legacy', ?)",
    ).bind(
      "20000000-0000-4000-8000-000000000098",
      legacyUserId,
      await sha256Hex(legacyToken),
      now,
    ).run();

    const invalid = await dispatch(legacyToken, "/me/replace-legacy-token", {
      method: "POST",
      body: JSON.stringify({ newToken: "not-a-valid-personal-token-value-0000" }),
    });
    expect(invalid.status).toBe(400);
    expect((await dispatch(legacyToken, "/me")).status).toBe(200);

    const replaced = await dispatch(legacyToken, "/me/replace-legacy-token", {
      method: "POST",
      body: JSON.stringify({ newToken: managerToken }),
    });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      userId: managerId,
      tokenKind: "personal",
    });
    expect((await dispatch(legacyToken, "/me")).status).toBe(401);
    expect(await (await dispatch(managerToken, "/me")).json()).toMatchObject({
      user: { tokenKind: "personal" },
    });
  });

  it("atomically creates a Project, its sole Board, and initial owner", async () => {
    const id = "20000000-0000-4000-8000-000000000010";
    const boardId = "20000000-0000-4000-8000-000000000012";
    const initialBoard = {
      version: 5,
      columns: [],
      cards: {},
      labels: [],
      deletedCards: {},
      lastSavedAt: "2026-07-27T00:00:00.000Z",
    };
    const create = () => dispatch(managerToken, "/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        workspaceId,
        name: "New Project",
        boardId,
        boardName: "Delivery Board",
        board: initialBoard,
        ownerUserId: secondManagerId,
      }),
    });
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
        .bind(id, secondManagerId).first<string>("role"),
    ).toBe("manager");
    expect(
      await env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
        .bind(id, managerId).first<string>("role"),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM activity_logs WHERE project_id = ?")
        .bind(id).first<number>("count"),
    ).toBe(2);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM boards WHERE project_id = ? AND status = 'active'")
        .bind(id).first<number>("count"),
    ).toBe(1);

    const conflict = await dispatch(managerToken, "/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "20000000-0000-4000-8000-000000000011",
        workspaceId,
        name: "new project",
        boardId: "20000000-0000-4000-8000-000000000013",
        boardName: "Other Board",
        board: initialBoard,
        ownerUserId: secondManagerId,
      }),
    });
    expect(conflict.status).toBe(409);
  });

  it("rolls back Project, Board, and owner when creation audit fails", async () => {
    const id = "20000000-0000-4000-8000-000000000014";
    await env.DB.prepare(
      `CREATE TRIGGER task_create_reject_board_audit
       BEFORE INSERT ON activity_logs
       WHEN NEW.action = 'board.created'
       BEGIN
         SELECT RAISE(ABORT, 'audit unavailable');
       END`,
    ).run();
    try {
      const response = await dispatch(managerToken, "/projects", {
        method: "POST",
        body: JSON.stringify({
          id,
          workspaceId,
          name: "Must Roll Back",
          boardId: "20000000-0000-4000-8000-000000000015",
          boardName: "Must Roll Back Board",
          board: { version: 5, columns: [], cards: {} },
          ownerUserId: secondManagerId,
        }),
      });
      expect(response.status).toBe(500);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = ?")
          .bind(id).first<number>("count"),
      ).toBe(0);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM boards WHERE project_id = ?")
          .bind(id).first<number>("count"),
      ).toBe(0);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?")
          .bind(id).first<number>("count"),
      ).toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER task_create_reject_board_audit").run();
    }
  });

  it("enforces viewer/manager capabilities and rename/archive/restore conflicts", async () => {
    expect((await dispatch(viewerToken, `/projects/${projectA}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Nope" }),
    })).status).toBe(403);
    await env.DB.prepare(
      "UPDATE project_members SET role = 'contributor' WHERE project_id = ? AND user_id = ?",
    ).bind(projectA, viewerId).run();
    expect((await dispatch(viewerToken, `/projects/${projectA}/members/${outsiderId}`, {
      method: "PUT",
      body: JSON.stringify({ role: "viewer" }),
    })).status).toBe(403);

    expect((await dispatch(managerToken, `/projects/${projectA}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    })).status).toBe(200);
    expect((await dispatch(managerToken, `/projects/${projectA}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    })).status).toBe(200);
    expect((await dispatch(managerToken, `/projects/${projectA}/archive`, { method: "POST" })).status).toBe(200);
    expect((await dispatch(managerToken, `/projects/${projectA}/archive`, { method: "POST" })).status).toBe(200);
    expect((await dispatch(managerToken, `/projects/${projectA}/restore`, { method: "POST" })).status).toBe(200);
    expect((await dispatch(managerToken, `/projects/${projectA}/restore`, { method: "POST" })).status).toBe(200);
    expect((await dispatch(managerToken, `/projects/${projectA}/archive`, { method: "POST" })).status).toBe(200);

    const now = "2026-07-26T02:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO projects (id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at) VALUES (?, ?, 'Renamed', 'renamed', 'active', ?, ?, ?)",
    ).bind("20000000-0000-4000-8000-000000000020", workspaceId, managerId, now, now).run();
    expect((await dispatch(managerToken, `/projects/${projectA}/restore`, { method: "POST" })).status).toBe(409);
  });

  it("rolls back a project mutation when its audit event cannot be written", async () => {
    await env.DB.prepare(
      `CREATE TRIGGER task5_reject_project_rename_audit
       BEFORE INSERT ON activity_logs
       WHEN NEW.action = 'project.renamed'
       BEGIN
         SELECT RAISE(ABORT, 'audit unavailable');
       END`,
    ).run();
    try {
      const response = await dispatch(managerToken, `/projects/${projectA}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Must Roll Back" }),
      });
      expect(response.status).toBe(500);
      expect(
        await env.DB.prepare("SELECT name FROM projects WHERE id = ?")
          .bind(projectA).first<string>("name"),
      ).toBe("Alpha");
    } finally {
      await env.DB.prepare("DROP TRIGGER task5_reject_project_rename_audit").run();
    }
  });

  it("prevents removing or downgrading the last owner and audits successful changes", async () => {
    const putMember = await dispatch(managerToken, `/projects/${projectA}/members/${managerId}`, {
      method: "PUT",
      body: JSON.stringify({ role: "member" }),
    });
    expect(putMember.status).toBe(409);
    expect((await dispatch(managerToken, `/projects/${projectA}/members/${managerId}`, {
      method: "DELETE",
    })).status).toBe(409);

    expect((await dispatch(managerToken, `/projects/${projectA}/members/${secondManagerId}`, {
      method: "PUT",
      body: JSON.stringify({ role: "owner" }),
    })).status).toBe(200);
    await env.DB.prepare(
      "UPDATE user_accounts SET status = 'disabled' WHERE id = ?",
    ).bind(secondManagerId).run();
    expect((await dispatch(managerToken, `/projects/${projectA}/members/${managerId}`, {
      method: "PUT",
      body: JSON.stringify({ role: "member" }),
    })).status).toBe(409);
    await env.DB.prepare(
      "UPDATE user_accounts SET status = 'active' WHERE id = ?",
    ).bind(secondManagerId).run();
    expect((await dispatch(managerToken, `/projects/${projectA}/members/${managerId}`, {
      method: "PUT",
      body: JSON.stringify({ role: "member" }),
    })).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM activity_logs WHERE project_id = ? AND entity_type = 'membership'",
      ).bind(projectA).first<number>("count"),
    ).toBe(2);
  });

  it("keeps membership administration available while a project is archived", async () => {
    await dispatch(managerToken, `/projects/${projectA}/archive`, { method: "POST" });
    const response = await dispatch(managerToken, `/projects/${projectA}/members/${secondManagerId}`, {
      method: "PUT",
      body: JSON.stringify({ role: "member" }),
    });
    expect(response.status).toBe(200);
  });

  it("lists members for readers and blocks Project APIs until migration completes", async () => {
    const members = await dispatch(viewerToken, `/projects/${projectA}/members`);
    expect(members.status).toBe(200);
    expect((await members.json() as { members: unknown[] }).members).toHaveLength(2);

    await env.DB.prepare("UPDATE migration_state SET status = 'pending' WHERE id = 1").run();
    const blocked = await dispatch(managerToken, "/projects");
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: "migration_required" });
  });
});
