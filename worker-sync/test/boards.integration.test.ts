import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "30000000-0000-4000-8000-000000000001";
const managerId = "30000000-0000-4000-8000-000000000002";
const contributorId = "30000000-0000-4000-8000-000000000003";
const viewerId = "30000000-0000-4000-8000-000000000004";
const outsiderId = "30000000-0000-4000-8000-000000000005";
const adminId = "30000000-0000-4000-8000-000000000006";
const projectA = "40000000-0000-4000-8000-000000000001";
const projectB = "40000000-0000-4000-8000-000000000002";
const boardA = "50000000-0000-4000-8000-000000000001";
const boardB = "50000000-0000-4000-8000-000000000002";
const boardC = "50000000-0000-4000-8000-000000000003";
const managerToken = "task6-manager-runtime-token-long-value";
const contributorToken = "task6-contributor-runtime-token-long-value";
const viewerToken = "task6-viewer-runtime-token-long-value";
const outsiderToken = "task6-outsider-runtime-token-long-value";
const adminToken = "task6-admin-runtime-token-long-value";
const maxBoardBytes = 1_000_000;

function board(version = 3, marker = "default"): Record<string, unknown> {
  return { version, columns: [], cards: {}, marker };
}

function assignedBoard(
  assigneeUserIds: string[],
  marker = "assigned",
): Record<string, unknown> {
  return {
    version: 5,
    marker,
    columns: [{ id: "todo", cardIds: ["task-1"] }],
    cards: {
      "task-1": {
        title: "Shared task",
        assigneeUserIds,
      },
    },
  };
}

function workflowBoard(title: string, marker = "workflow"): Record<string, unknown> {
  return {
    version: 6,
    marker,
    columns: [{ id: "todo", title, wipLimit: 3, cardIds: [] }],
    cards: {},
  };
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
    "CREATE UNIQUE INDEX IF NOT EXISTS task6_board_name_unique ON boards(project_id, normalized_name) WHERE status = 'active'",
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
  await insertUser(managerId, managerToken);
  await insertUser(contributorId, contributorToken);
  await insertUser(viewerId, viewerToken);
  await insertUser(outsiderId, outsiderToken);
  await insertUser(adminId, adminToken);
  const now = "2026-07-27T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'Workspace', ?, ?)",
  ).bind(workspaceId, now, now).run();
  await env.DB.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?)",
  ).bind(workspaceId, adminId, now, now).run();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at
     ) VALUES (?, ?, 'Alpha', 'alpha', 'active', ?, ?, ?),
              (?, ?, 'Beta', 'beta', 'active', ?, ?, ?)`,
  ).bind(
    projectA, workspaceId, managerId, now, now,
    projectB, workspaceId, outsiderId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'manager', ?, ?),
            (?, ?, 'contributor', ?, ?),
            (?, ?, 'viewer', ?, ?),
            (?, ?, 'manager', ?, ?)`,
  ).bind(
    projectA, managerId, now, now,
    projectA, contributorId, now, now,
    projectA, viewerId, now, now,
    projectB, outsiderId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO migration_state (
       id, status, default_workspace_id, legacy_project_id, legacy_board_id, updated_at
     ) VALUES (1, 'complete', ?, ?, ?, ?)`,
  ).bind(workspaceId, projectA, boardA, now).run();
});

describe("Single-board Project content APIs", () => {
  it("lists only boards in an accessible project and hides cross-project guesses", async () => {
    expect((await createBoard(managerToken, projectA, boardA, "Roadmap")).status).toBe(201);
    expect((await createBoard(outsiderToken, projectB, boardB, "Private")).status).toBe(201);

    const list = await dispatch(viewerToken, `/projects/${projectA}/boards`);
    expect(list.status).toBe(200);
    expect(
      (await list.json() as { boards: Array<{ id: string }> }).boards.map((item) => item.id),
    ).toEqual([boardA]);
    expect(
      (await dispatch(managerToken, `/projects/${projectA}/boards/${boardB}`)).status,
    ).toBe(404);
    expect(
      (await dispatch(adminToken, `/projects/${projectA}/boards/${boardA}`)).status,
    ).toBe(404);
  });

  it("creates idempotently, enforces manager capability, and scopes active names per project", async () => {
    const first = await createBoard(managerToken, projectA, boardA, "Roadmap");
    expect(first.status).toBe(201);
    expect((await createBoard(managerToken, projectA, boardA, "Roadmap")).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM activity_logs WHERE board_id = ?")
        .bind(boardA).first<number>("count"),
    ).toBe(1);
    expect(
      (await createBoard(managerToken, projectA, boardB, "roadmap")).status,
    ).toBe(409);
    expect(
      (await createBoard(outsiderToken, projectB, boardB, "Roadmap")).status,
    ).toBe(201);
    expect(
      (await createBoard(contributorToken, projectA, boardC, "Contributor Board")).status,
    ).toBe(403);
  });

  it("enforces role capabilities, allows a second active Board, and revision conflicts", async () => {
    await createBoard(managerToken, projectA, boardA, "A", board(3, "A0"));
    // 多看板 v1（migration 0005）取代了「每專案僅一個 active Board」的舊假設：
    // 同專案、不同名稱的第二個 Board 現在應該建立成功，不再是 409 project_board_exists。
    const secondBoard = await createBoard(managerToken, projectA, boardB, "B", board(3, "B0"));
    expect(secondBoard.status).toBe(201);
    expect((await secondBoard.json() as { board: { id: string } }).board.id).toBe(boardB);

    const viewerGet = await dispatch(viewerToken, `/projects/${projectA}/boards/${boardA}`);
    expect(viewerGet.status).toBe(200);
    expect(await viewerGet.json()).toMatchObject({
      board: { id: boardA, content: { revision: 0, board: { marker: "A0" } } },
    });
    expect((await dispatch(viewerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: board(4, "viewer") }),
    })).status).toBe(403);
    expect((await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Nope" }),
    })).status).toBe(403);

    expect((await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: board(4, "A1") }),
    })).status).toBe(200);
    const conflict = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: board(5, "stale") }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      revision: 1,
      board: { marker: "A1" },
    });
    // 兩個 Board（A、B）都維持 active——多看板 v1 下這是預期狀態。
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM boards WHERE project_id = ? AND status = 'active'")
        .bind(projectA).first<number>("count"),
    ).toBe(2);
  });

  it("allows only managers to change workflow column settings", async () => {
    expect((await createBoard(
      managerToken,
      projectA,
      boardA,
      "Workflow",
      workflowBoard("待辦"),
    )).status).toBe(201);

    const contributorRename = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 0,
          board: workflowBoard("需求池", "contributor-rename"),
        }),
      },
    );
    expect(contributorRename.status).toBe(403);

    const managerRename = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 0,
          board: workflowBoard("需求池", "manager-rename"),
        }),
      },
    );
    expect(managerRename.status).toBe(200);

    const expanded = workflowBoard("需求池", "manager-add-column");
    (expanded.columns as Array<Record<string, unknown>>).push({
      id: "qa",
      title: "驗收",
      wipLimit: 2,
      cardIds: [],
    });
    const managerAdd = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ baseRevision: 1, board: expanded }),
      },
    );
    expect(managerAdd.status).toBe(200);

    const reordered = structuredClone(expanded);
    reordered.columns = [...(reordered.columns as unknown[])].reverse();
    const contributorReorder = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ baseRevision: 2, board: reordered }),
      },
    );
    expect(contributorReorder.status).toBe(403);

    const removed = workflowBoard("需求池", "manager-delete-empty-column");
    const managerDelete = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ baseRevision: 2, board: removed }),
      },
    );
    expect(managerDelete.status).toBe(200);
  });

  it("rejects deleting a workflow column that still contains tasks", async () => {
    const withTask = {
      version: 6,
      columns: [
        { id: "todo", title: "待辦", wipLimit: 3, cardIds: ["task-1"] },
        { id: "done", title: "完成", wipLimit: null, cardIds: [] },
      ],
      cards: { "task-1": { title: "保留的任務", assigneeUserIds: [] } },
    };
    expect((await createBoard(
      managerToken,
      projectA,
      boardA,
      "Workflow",
      withTask,
    )).status).toBe(201);

    const response = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 0,
          board: {
            ...withTask,
            columns: [{ id: "done", title: "完成", wipLimit: null, cardIds: [] }],
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "column_not_empty" });
  });

  it("preserves at least one work column beside the completion column", async () => {
    const minimal = {
      version: 6,
      columns: [
        { id: "todo", title: "待辦", wipLimit: 3, cardIds: [] },
        { id: "done", title: "完成", wipLimit: null, cardIds: [] },
      ],
      cards: {},
    };
    expect((await createBoard(
      managerToken,
      projectA,
      boardA,
      "Workflow",
      minimal,
    )).status).toBe(201);

    const response = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 0,
          board: {
            ...minimal,
            columns: [{ id: "done", title: "完成", wipLimit: null, cardIds: [] }],
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_workflow" });
  });

  it("allows multiple Project assignees, rejects outsiders, and preserves departed assignments", async () => {
    const created = await createBoard(
      managerToken,
      projectA,
      boardA,
      "Assigned",
      assignedBoard([managerId, contributorId]),
    );
    expect(created.status).toBe(201);

    const expanded = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 0,
          board: assignedBoard([managerId, contributorId, viewerId], "expanded"),
        }),
      },
    );
    expect(expanded.status).toBe(200);

    const outsider = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 1,
          board: assignedBoard(
            [managerId, contributorId, viewerId, outsiderId],
            "invalid",
          ),
        }),
      },
    );
    expect(outsider.status).toBe(400);
    expect(await outsider.json()).toMatchObject({
      error: "assignee_not_project_member",
    });

    const duplicate = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 1,
          board: assignedBoard([managerId, managerId], "duplicate"),
        }),
      },
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ error: "invalid_assignees" });

    const tooMany = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 1,
          board: assignedBoard(
            Array.from({ length: 21 }, (_, index) =>
              `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
            "too-many",
          ),
        }),
      },
    );
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: "invalid_assignees" });

    await env.DB.prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
    ).bind(projectA, contributorId).run();
    const preserved = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({
          baseRevision: 1,
          board: assignedBoard([managerId, contributorId, viewerId], "preserved"),
        }),
      },
    );
    expect(preserved.status).toBe(200);
  });

  it("converges concurrent base revision zero writes to one success and one conflict", async () => {
    await createBoard(managerToken, projectA, boardC, "Concurrent");
    const put = (marker: string) => dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardC}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ baseRevision: 0, board: board(4, marker) }),
      },
    );
    const responses = await Promise.all([put("one"), put("two")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await env.DB.prepare("SELECT revision FROM boards WHERE id = ?")
        .bind(boardC).first<number>("revision"),
    ).toBe(1);
  });

  it("keeps the sole active Board and only restores history when no active Board exists", async () => {
    await createBoard(managerToken, projectA, boardA, "Roadmap", board(3, "before"));
    await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: board(4, "saved") }),
    });
    const archive = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/archive`, {
      method: "POST",
    });
    expect(archive.status).toBe(409);
    expect(await archive.json()).toMatchObject({ error: "single_board_required" });
    // 併發封存防護的迴歸測試：專案僅剩一個 active Board 時，被擋下的封存
    // 必須是原子失敗（WHERE 子句未命中），board 本身仍是 active，不會有
    // 「UPDATE 先跑、事後才發現要擋」的中間狀態。
    expect(
      await env.DB.prepare("SELECT status FROM boards WHERE id = ?")
        .bind(boardA).first<string>("status"),
    ).toBe("active");

    const archivedAt = "2026-07-27T01:00:00.000Z";
    await env.DB.prepare(
      "UPDATE boards SET status = 'archived', archived_at = ?, archived_by = ? WHERE id = ?",
    ).bind(archivedAt, managerId, boardA).run();

    const archived = await dispatch(viewerToken, `/projects/${projectA}/boards/${boardA}`);
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      board: {
        status: "archived",
        content: { revision: 1, board: { marker: "saved" } },
      },
    });
    const blocked = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ baseRevision: 1, board: board(5, "blocked") }),
      },
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "resource_archived" });

    await createBoard(managerToken, projectA, boardB, "Roadmap");
    expect((await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/restore`, {
      method: "POST",
    })).status).toBe(409);
    await env.DB.prepare(
      "UPDATE boards SET status = 'archived', archived_at = ?, archived_by = ? WHERE id = ?",
    ).bind(archivedAt, managerId, boardB).run();
    expect((await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/restore`, {
      method: "POST",
    })).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT revision FROM boards WHERE id = ?")
        .bind(boardA).first<number>("revision"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM activity_logs WHERE board_id = ?")
        .bind(boardA).first<number>("count"),
    ).toBe(3);

    await env.DB.prepare(
      "UPDATE projects SET status = 'archived', archived_at = ?, archived_by = ? WHERE id = ?",
    ).bind("2026-07-27T02:00:00.000Z", managerId, projectA).run();
    expect((await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Project Is Archived" }),
    })).status).toBe(409);
  });

  it("rolls back content when audit insertion fails", async () => {
    await createBoard(managerToken, projectA, boardA, "Audit");
    await env.DB.prepare(
      `CREATE TRIGGER task6_reject_content_audit
       BEFORE INSERT ON activity_logs
       WHEN NEW.action = 'board.content_updated'
       BEGIN
         SELECT RAISE(ABORT, 'audit unavailable');
       END`,
    ).run();
    try {
      const response = await dispatch(
        contributorToken,
        `/projects/${projectA}/boards/${boardA}/content`,
        {
          method: "PUT",
          body: JSON.stringify({ baseRevision: 0, board: board(4, "must-roll-back") }),
        },
      );
      expect(response.status).toBe(500);
      expect(
        await env.DB.prepare("SELECT revision FROM boards WHERE id = ?")
          .bind(boardA).first<number>("revision"),
      ).toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER task6_reject_content_audit").run();
    }
  });

  it("bounds streamed Board JSON and blocks nested APIs until migration completes", async () => {
    await createBoard(managerToken, projectA, boardA, "Bounded");
    const tooLarge = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(maxBoardBytes + 1));
            controller.close();
          },
        }),
      },
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: "board_too_large" });

    await env.DB.prepare("UPDATE migration_state SET status = 'pending' WHERE id = 1").run();
    const blocked = await dispatch(viewerToken, `/projects/${projectA}/boards`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: "migration_required" });
  });
});

type MetadataChange = { kind: string; fields?: string[] };

async function latestBoardContentMetadata(boardId: string): Promise<{ changes: MetadataChange[] }> {
  const row = await env.DB.prepare(
    `SELECT metadata FROM activity_logs
     WHERE board_id = ? AND action = 'board.content_updated'
     ORDER BY occurred_at DESC, id DESC LIMIT 1`,
  ).bind(boardId).first<{ metadata: string }>();
  return JSON.parse(row!.metadata) as { changes: MetadataChange[] };
}

describe("Flow field validation, Board settings guard, and Activity Log flow tracking", () => {
  it("rejects a card with a serviceClass outside the fixed enum", async () => {
    await createBoard(managerToken, projectA, boardA, "Flow");
    const response = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: {
          version: 6,
          columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] }],
          cards: { "task-1": { title: "Task", serviceClass: "urgent" } },
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_flow_fields" });
  });

  it("rejects a negative or non-numeric blockedMs", async () => {
    await createBoard(managerToken, projectA, boardA, "Flow");
    const negative = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: {
          version: 6,
          columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] }],
          cards: { "task-1": { title: "Task", blockedMs: -5 } },
        },
      }),
    });
    expect(negative.status).toBe(400);
    expect(await negative.json()).toMatchObject({ error: "invalid_flow_fields" });

    const notANumber = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: {
          version: 6,
          columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] }],
          cards: { "task-1": { title: "Task", blockedMs: "5" } },
        },
      }),
    });
    expect(notANumber.status).toBe(400);
    expect(await notANumber.json()).toMatchObject({ error: "invalid_flow_fields" });
  });

  it("rejects a columnEnteredAt that is not a valid timestamp", async () => {
    await createBoard(managerToken, projectA, boardA, "Flow");
    const response = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: {
          version: 6,
          columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] }],
          cards: { "task-1": { title: "Task", columnEnteredAt: "not-a-date" } },
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_flow_fields" });
  });

  it("accepts a v6 client payload with none of the new flow fields", async () => {
    await createBoard(managerToken, projectA, boardA, "Flow", board(3, "v6-legacy"));
    const response = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: board(4, "v6-legacy-updated") }),
    });
    expect(response.status).toBe(200);
  });

  it("forbids a member from changing Board settings the owner set", async () => {
    await createBoard(managerToken, projectA, boardA, "Settings");
    const withSettings = {
      version: 6,
      columns: [],
      cards: {},
      settings: { agingWarnDays: 3, agingAlertDays: 5, expediteWipLimit: 2 },
    };
    const ownerPut = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: withSettings }),
    });
    expect(ownerPut.status).toBe(200);

    const differentSettings = {
      ...withSettings,
      settings: { agingWarnDays: 10, agingAlertDays: 20, expediteWipLimit: 5 },
    };
    const memberPut = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 1, board: differentSettings }),
    });
    expect(memberPut.status).toBe(403);
    expect(await memberPut.json()).toMatchObject({ error: "forbidden" });
  });

  it("preserves owner-set Board settings when a member PUTs a board without settings", async () => {
    await createBoard(managerToken, projectA, boardA, "Settings");
    const withSettings = {
      version: 6,
      columns: [],
      cards: {},
      settings: { agingWarnDays: 3, agingAlertDays: 5, expediteWipLimit: 2 },
    };
    expect((await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: withSettings }),
    })).status).toBe(200);

    const noSettings = { version: 6, columns: [], cards: {}, marker: "no-settings" };
    const memberPut = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 1, board: noSettings }),
    });
    expect(memberPut.status).toBe(200);

    const detail = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}`);
    expect(await detail.json()).toMatchObject({
      board: {
        content: {
          board: {
            settings: { agingWarnDays: 3, agingAlertDays: 5, expediteWipLimit: 2 },
          },
        },
      },
    });
  });

  it("allows a member to edit a pre-feature board (no settings key) when it carries default settings", async () => {
    await createBoard(managerToken, projectA, boardA, "Legacy Settings", board(3, "pre-feature"));
    const memberPut = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: {
          version: 7,
          columns: [],
          cards: {},
          settings: { agingWarnDays: 3, agingAlertDays: 7, expediteWipLimit: 1 },
        },
      }),
    });
    expect(memberPut.status).toBe(200);
  });

  it("forbids a member from introducing non-default settings on a pre-feature board (no settings key)", async () => {
    await createBoard(managerToken, projectA, boardA, "Legacy Settings", board(3, "pre-feature"));
    const memberPut = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: {
          version: 7,
          columns: [],
          cards: {},
          settings: { agingWarnDays: 5, agingAlertDays: 10, expediteWipLimit: 2 },
        },
      }),
    });
    expect(memberPut.status).toBe(403);
    expect(await memberPut.json()).toMatchObject({ error: "forbidden" });
  });

  it("rejects a settings field that is not an object", async () => {
    await createBoard(managerToken, projectA, boardA, "Settings");
    const memberPut = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevision: 0,
        board: { version: 7, columns: [], cards: {}, settings: [] },
      }),
    });
    expect(memberPut.status).toBe(400);
    expect(await memberPut.json()).toMatchObject({ error: "invalid_settings" });
  });

  it("logs serviceClass in card.updated fields when a member changes it", async () => {
    const withCard = {
      version: 6,
      columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] }],
      cards: { "task-1": { title: "Task", serviceClass: "standard" } },
    };
    await createBoard(managerToken, projectA, boardA, "Cards", withCard);
    const updated = {
      ...withCard,
      cards: { "task-1": { title: "Task", serviceClass: "expedite" } },
    };
    const response = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: updated }),
    });
    expect(response.status).toBe(200);

    const metadata = await latestBoardContentMetadata(boardA);
    const cardUpdated = metadata.changes.find((change) => change.kind === "card.updated");
    expect(cardUpdated?.fields).toContain("serviceClass");
  });

  it("does not report columnEnteredAt/startedAt/blockedMs churn as a card.updated field when only moving a card", async () => {
    const moveBase = {
      version: 6,
      columns: [
        { id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] },
        { id: "doing", title: "進行中", wipLimit: null, cardIds: [] },
      ],
      cards: {
        "task-1": {
          title: "Task",
          serviceClass: "standard",
          columnEnteredAt: "2026-07-27T00:00:00.000Z",
          startedAt: null as string | null,
          blockedMs: 0,
        },
      },
    };
    await createBoard(managerToken, projectA, boardA, "Move", moveBase);
    const moved = structuredClone(moveBase);
    (moved.columns[0] as { cardIds: string[] }).cardIds = [];
    (moved.columns[1] as { cardIds: string[] }).cardIds = ["task-1"];
    moved.cards = {
      "task-1": {
        title: "Task",
        serviceClass: "standard",
        columnEnteredAt: "2026-07-27T01:00:00.000Z",
        startedAt: "2026-07-27T01:00:00.000Z",
        blockedMs: 120_000,
      },
    };
    const response = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: moved }),
    });
    expect(response.status).toBe(200);

    const metadata = await latestBoardContentMetadata(boardA);
    expect(metadata.changes.some((change) => change.kind === "card.moved")).toBe(true);
    const cardUpdated = metadata.changes.find((change) => change.kind === "card.updated");
    expect(cardUpdated).toBeUndefined();
  });
});
