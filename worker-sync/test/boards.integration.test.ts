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

/** 直接寫入指派列，模擬 Task 5 指派 API 落地前的指派狀態
 *（沿用 board-access.integration.test.ts 的既有慣例）。 */
async function assignBoard(projectId: string, userId: string, boardId: string) {
  await env.DB.prepare(
    `INSERT INTO project_member_boards (project_id, user_id, board_id, assigned_by, assigned_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(projectId, userId, boardId, managerId, "2026-07-27T00:00:00.000Z").run();
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
    // migration 0005：看板指派表（Task 2 起 listBoards/getBoardDetail/putBoardContent
    // 會透過 board-access.ts 查詢此表決定 contributor 可見範圍）。
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
    "CREATE INDEX IF NOT EXISTS task6_project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
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
    // Board 可見性 v1：B 較新，是無指派 contributor 的 fallback 主要看板，A 反而不可見。
    // 這裡要測的是能力檢查與 revision 衝突，與可見性無關，故明確指派 contributor 到 A。
    await assignBoard(projectA, contributorId, boardA);

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

    // 指派管理已收斂到 owner（見「Assignment windows validation」describe block），
    // 這裡改由 managerToken 送出，讓本測試繼續驗證指派清單本身的驗證規則
    // （人數上限／重複／非專案成員），不與 owner-only 403 混在一起判讀。
    const expanded = await dispatch(
      managerToken,
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
      managerToken,
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
      managerToken,
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
      managerToken,
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
    // Board 可見性 v1：A 現在是唯一但已封存的 Board，沒有 active Board 可供 fallback，
    // 無指派的 contributor 會直接 404（不可見）。這裡要測的是「已封存即唯讀」
    // （resource_archived），與可見性無關，故明確指派 contributor 到 A。
    await assignBoard(projectA, contributorId, boardA);
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

  it("scopes an unassigned contributor to the primary (most recently updated) Board", async () => {
    expect((await createBoard(managerToken, projectA, boardA, "Older", board(3, "older"))).status)
      .toBe(201);
    expect((await createBoard(managerToken, projectA, boardB, "Newer", board(3, "newer"))).status)
      .toBe(201);

    const list = await dispatch(contributorToken, `/projects/${projectA}/boards?status=active`);
    expect(list.status).toBe(200);
    expect(
      (await list.json() as { boards: Array<{ id: string }> }).boards.map((item) => item.id),
    ).toEqual([boardB]);

    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}`)).status,
    ).toBe(404);
    expect((await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/content`, {
      method: "PUT",
      body: JSON.stringify({ baseRevision: 0, board: board(4, "blocked") }),
    })).status).toBe(404);
    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardB}`)).status,
    ).toBe(200);
  });

  it("shows exactly the assigned Board to a contributor once an assignment row exists", async () => {
    await createBoard(managerToken, projectA, boardA, "Older", board(3, "older"));
    await createBoard(managerToken, projectA, boardB, "Newer", board(3, "newer"));
    await assignBoard(projectA, contributorId, boardA);

    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}`)).status,
    ).toBe(200);
    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardB}`)).status,
    ).toBe(404);

    const list = await dispatch(contributorToken, `/projects/${projectA}/boards?status=active`);
    expect(
      (await list.json() as { boards: Array<{ id: string }> }).boards.map((item) => item.id),
    ).toEqual([boardA]);
  });

  it("keeps the owner fully visible across every Board regardless of assignment rows", async () => {
    await createBoard(managerToken, projectA, boardA, "Older", board(3, "older"));
    await createBoard(managerToken, projectA, boardB, "Newer", board(3, "newer"));
    await assignBoard(projectA, contributorId, boardA);

    expect(
      (await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}`)).status,
    ).toBe(200);
    expect(
      (await dispatch(managerToken, `/projects/${projectA}/boards/${boardB}`)).status,
    ).toBe(200);

    const list = await dispatch(managerToken, `/projects/${projectA}/boards?status=active`);
    expect(
      (await list.json() as { boards: Array<{ id: string }> }).boards.map((item) => item.id).sort(),
    ).toEqual([boardA, boardB].sort());
  });

  it("keeps an archived assigned Board visible and read-only to its contributor", async () => {
    await createBoard(managerToken, projectA, boardA, "Older", board(3, "older"));
    await createBoard(managerToken, projectA, boardB, "Newer", board(3, "newer"));
    await assignBoard(projectA, contributorId, boardA);

    const archive = await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/archive`, {
      method: "POST",
    });
    expect(archive.status).toBe(200);
    expect((await archive.json() as { board: { id: string; status: string } }).board)
      .toMatchObject({ id: boardA, status: "archived" });
    expect(
      await env.DB.prepare("SELECT status FROM boards WHERE id = ?")
        .bind(boardA).first<string>("status"),
    ).toBe("archived");

    const list = await dispatch(contributorToken, `/projects/${projectA}/boards?status=archived`);
    expect(list.status).toBe(200);
    expect(
      (await list.json() as { boards: Array<{ id: string }> }).boards.map((item) => item.id),
    ).toEqual([boardA]);

    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}`)).status,
    ).toBe(200);
    const blockedWrite = await dispatch(
      contributorToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ baseRevision: 0, board: board(4, "blocked-write") }),
      },
    );
    expect(blockedWrite.status).toBe(409);
    expect(await blockedWrite.json()).toMatchObject({ error: "resource_archived" });
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

const ALICE = "11111111-2222-4333-8444-555555555555";

/** 單卡 board：固定一個欄位「todo」與一張卡片「task-1」，cardPatch 覆蓋卡片欄位。
 *  不主動塞入 assignmentWindows／assigneeUserIds，缺席即缺席，模擬各版本 client 送出的形狀。 */
function boardWithCard(
  cardPatch: Record<string, unknown>,
  marker = "assignment",
): Record<string, unknown> {
  return {
    version: 8,
    marker,
    columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1"] }],
    cards: {
      "task-1": { title: "Task", ...cardPatch },
    },
  };
}

async function putBoardContentAt(
  token: string,
  baseRevision: number,
  data: Record<string, unknown>,
): Promise<Response> {
  return dispatch(token, `/projects/${projectA}/boards/${boardA}/content`, {
    method: "PUT",
    body: JSON.stringify({ baseRevision, board: data }),
  });
}

describe("Assignment windows validation and owner-only assignment management", () => {
  beforeEach(async () => {
    // requireNewAssigneesAreProjectMembers 要求「新指派的人」必須是專案成員；
    // ALICE 在這個 describe 專門扮演「可被指派的一般成員」，與角色命名的
    // manager/contributor/viewer 語意分開。
    const now = "2026-07-27T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'contributor', ?, ?)`,
    ).bind(projectA, ALICE, now, now).run();
  });

  it("rejects malformed assignment windows when creating a board", async () => {
    // 計畫缺口修正：/assignments（Task 3）直接用 SQL 讀 boards.data 裡的
    // window，不經過 client 的 normalize；createBoard 是資料第一次落地的
    // 地方，格式錯誤的值若在這裡漏網，會原樣存進 D1，後續被 SQL 撈出來
    // 送到前端排版計算時才壞掉。structural 驗證必須在建立看板時就擋。
    const response = await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-8-7", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_assignment_windows" });
  });

  it("lets the project owner create a board with valid assignment windows", async () => {
    const response = await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(201);
  });

  it("rejects malformed assignment windows with 400", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments");
    const response = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-8-7", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_assignment_windows" });
  });

  it("rejects a window whose userId is not assigned", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments");
    const response = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_assignment_windows" });
  });

  it("rejects a reversed window", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments");
    const response = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-13", endDate: "2026-08-07" }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_assignment_windows" });
  });

  it("rejects duplicate windows for the same user", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments");
    const response = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [
        { userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-08" },
        { userId: ALICE, startDate: "2026-08-09", endDate: "2026-08-10" },
      ],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_assignment_windows" });
  });

  it("lets the project owner set assignments and windows", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments");
    const response = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(200);
  });

  it("forbids a member from changing assignees", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({ assigneeUserIds: [] }));
    const response = await putBoardContentAt(contributorToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
  });

  it("forbids a member from changing assignment windows", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
    }));
    const ownerPut = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(ownerPut.status).toBe(200);

    const response = await putBoardContentAt(contributorToken, 1, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-20" }],
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
  });

  it("lets a member edit other card fields while assignments stay identical", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
    }));
    const ownerPut = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(ownerPut.status).toBe(200);

    const response = await putBoardContentAt(contributorToken, 1, boardWithCard({
      title: "改過的標題",
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(200);
  });

  it("lets a member edit a legacy board that has no assignmentWindows key", async () => {
    // 直接以 owner 建立沒有 assignmentWindows 鍵的 board，模擬功能上線前的資料。
    await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
    }, "pre-feature"));
    const response = await putBoardContentAt(contributorToken, 0, boardWithCard({
      title: "member 編輯",
      assigneeUserIds: [ALICE],
    }));
    expect(response.status).toBe(200);
  });

  it("treats an absent key and an empty array as the same signature", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
    }, "pre-feature"));
    const response = await putBoardContentAt(contributorToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [],
    }));
    expect(response.status).toBe(200);
  });

  it("lets a member edit a board whose card order is reversed but content is unchanged", async () => {
    // mutation 防線：entries.sort 若被移除，Object.entries 的插入順序差異會讓內容相同的
    // 兩份 cards 誤判為「指派變更」而 403（見 assignmentSignature 上方註解）。
    const cards = {
      "task-1": { title: "Task 1", assigneeUserIds: [ALICE] },
      "task-2": { title: "Task 2", assigneeUserIds: [] as string[] },
    };
    await createBoard(managerToken, projectA, boardA, "Assignments", {
      version: 8,
      marker: "order",
      columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1", "task-2"] }],
      cards,
    });
    const reversed = {
      version: 8,
      marker: "order-reversed",
      columns: [{ id: "todo", title: "待辦", wipLimit: null, cardIds: ["task-1", "task-2"] }],
      cards: { "task-2": cards["task-2"], "task-1": cards["task-1"] },
    };
    const response = await putBoardContentAt(contributorToken, 0, reversed);
    expect(response.status).toBe(200);
  });

  it("records assignmentWindows as a changed field in the activity log without logging dates", async () => {
    await createBoard(managerToken, projectA, boardA, "Assignments", boardWithCard({
      assigneeUserIds: [ALICE],
    }));
    const response = await putBoardContentAt(managerToken, 0, boardWithCard({
      assigneeUserIds: [ALICE],
      assignmentWindows: [{ userId: ALICE, startDate: "2026-08-07", endDate: "2026-08-13" }],
    }));
    expect(response.status).toBe(200);

    const metadata = await latestBoardContentMetadata(boardA);
    const cardUpdated = metadata.changes.find((change) => change.kind === "card.updated");
    expect(cardUpdated?.fields).toContain("assignmentWindows");
    expect(JSON.stringify(metadata)).not.toContain("2026-08-07");
  });
});
