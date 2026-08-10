import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "81000000-0000-4000-8000-000000000001";
const managerId = "81000000-0000-4000-8000-000000000002";
const viewerId = "81000000-0000-4000-8000-000000000003";
const outsiderId = "81000000-0000-4000-8000-000000000004";
const contributorId = "81000000-0000-4000-8000-000000000005";
const projectA = "82000000-0000-4000-8000-000000000001";
const projectB = "82000000-0000-4000-8000-000000000002";
const boardA = "83000000-0000-4000-8000-000000000001";
const boardB = "83000000-0000-4000-8000-000000000002";
const boardA2 = "83000000-0000-4000-8000-000000000003";
const managerToken = "task7-log-manager-runtime-token-long-value";
const viewerToken = "task7-log-viewer-runtime-token-long-value";
const outsiderToken = "task7-log-outsider-runtime-token-long-value";
const contributorToken = "task7-log-contributor-runtime-token-long-value";

function card(
  description: string,
  attachment: Record<string, unknown>,
): Record<string, unknown> {
  return {
    title: "Private card",
    description,
    priority: "medium",
    labelIds: [],
    dueDate: "",
    checklist: [],
    members: [],
    attachments: [attachment],
    completedAt: null,
  };
}

function board(description: string, attachment: Record<string, unknown>) {
  return {
    version: 4,
    columns: [{ id: "todo", cardIds: ["card-private"] }],
    cards: { "card-private": card(description, attachment) },
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

async function insertLog(
  id: string,
  projectId: string,
  boardId: string | null,
  occurredAt: string,
) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (
       id, workspace_id, project_id, board_id, actor_user_id, action,
       entity_type, entity_id, revision, metadata, occurred_at
     ) VALUES (?, ?, ?, ?, ?, 'test.action', 'board', ?, 1, '{}', ?)`,
  ).bind(id, workspaceId, projectId, boardId, managerId, boardId ?? projectId, occurredAt).run();
}

/** 重現 projects.ts createProject 落的 project.created 事件形狀：project-level
 *（board_id 為 NULL），但 metadata 挾帶初始看板的 boardId／boardName（見
 *  Task 3 審查回合 1 發現的洩漏）。 */
async function insertProjectCreatedLog(
  id: string,
  projectId: string,
  embeddedBoardId: string,
  embeddedBoardName: string,
  occurredAt: string,
) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (
       id, workspace_id, project_id, board_id, actor_user_id, action,
       entity_type, entity_id, revision, metadata, occurred_at
     ) VALUES (?, ?, ?, NULL, ?, 'project.created', 'project', ?, NULL, ?, ?)`,
  ).bind(
    id, workspaceId, projectId, managerId, projectId,
    JSON.stringify({
      name: "Alpha", boardId: embeddedBoardId, boardName: embeddedBoardName, ownerUserId: managerId,
    }),
    occurredAt,
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
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT, legacy_project_id TEXT, legacy_board_id TEXT, locked_at TEXT, completed_at TEXT, updated_at TEXT, error TEXT)",
    // migration 0005：看板指派表（Task 3 起 logs 會透過 board-access.ts 查詢此表
    // 決定 contributor 可見範圍；resolveVisibleBoardIds 的 fallback 分支即使沒有
    // 任何指派列也會 SELECT 這張表，表不存在會直接噴 SQL 錯誤）。
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
    "CREATE INDEX IF NOT EXISTS task7_project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
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
  const now = "2026-07-27T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO migration_state (id, status, updated_at) VALUES (1, 'complete', ?)",
  ).bind(now).run();
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
    projectB, workspaceId, outsiderId, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'manager', ?, ?),
            (?, ?, 'viewer', ?, ?),
            (?, ?, 'manager', ?, ?)`,
  ).bind(
    projectA, managerId, now, now,
    projectA, viewerId, now, now,
    projectB, outsiderId, now, now,
  ).run();
  const oldBoard = JSON.stringify(board("old-private-description", {
    id: "attachment-old",
    type: "image/png",
    fileName: "private-before.png",
    bytes: "base64-secret-before",
  }));
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at, archived_at, archived_by
     ) VALUES (?, ?, 'Board A', 'board a', 'active', 0, ?, ?, ?, ?, NULL, NULL),
              (?, ?, 'Board B', 'board b', 'active', 0, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    boardA, projectA, oldBoard, managerId, now, now,
    boardB, projectB, oldBoard, outsiderId, now, now,
  ).run();
});

describe("Activity Log APIs", () => {
  it("uses a stable id tie-breaker for cursor pagination", async () => {
    const timestamp = "2026-07-27T03:00:00.000Z";
    const ids = [
      "84000000-0000-4000-8000-000000000001",
      "84000000-0000-4000-8000-000000000002",
      "84000000-0000-4000-8000-000000000003",
    ];
    for (const id of ids) await insertLog(id, projectA, boardA, timestamp);

    const first = await dispatch(viewerToken, `/projects/${projectA}/logs?limit=2`);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      logs: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.logs.map((log) => log.id)).toEqual([ids[2], ids[1]]);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await dispatch(
      viewerToken,
      `/projects/${projectA}/logs?limit=2&cursor=${firstBody.nextCursor}`,
    );
    const secondBody = await second.json() as {
      logs: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(secondBody.logs.map((log) => log.id)).toEqual([ids[0]]);
    expect(secondBody.nextCursor).toBeNull();
    expect(new Set([...firstBody.logs, ...secondBody.logs].map((log) => log.id)).size).toBe(3);
  });

  it("scopes project and board logs and hides guessed resources", async () => {
    await insertLog("84000000-0000-4000-8000-000000000010", projectA, boardA, "2026-07-27T04:00:00.000Z");
    await insertLog("84000000-0000-4000-8000-000000000011", projectA, null, "2026-07-27T04:01:00.000Z");
    await insertLog("84000000-0000-4000-8000-000000000012", projectB, boardB, "2026-07-27T04:02:00.000Z");

    const boardResponse = await dispatch(
      viewerToken,
      `/projects/${projectA}/boards/${boardA}/logs`,
    );
    const boardBody = await boardResponse.json() as { logs: Array<{ boardId: string | null }> };
    expect(boardBody.logs).toHaveLength(1);
    expect(boardBody.logs[0].boardId).toBe(boardA);

    const projectResponse = await dispatch(viewerToken, `/projects/${projectA}/logs`);
    const projectBody = await projectResponse.json() as { logs: Array<{ projectId: string }> };
    expect(projectBody.logs).toHaveLength(2);
    expect(projectBody.logs.every((log) => log.projectId === projectA)).toBe(true);
    expect(
      (await dispatch(viewerToken, `/projects/${projectA}/boards/${boardB}/logs`)).status,
    ).toBe(404);
    expect((await dispatch(outsiderToken, `/projects/${projectA}/logs`)).status).toBe(404);
  });

  it("returns archived history and validates pagination inputs", async () => {
    await env.DB.prepare(
      "UPDATE projects SET status = 'archived', archived_at = ? WHERE id = ?",
    ).bind("2026-07-27T05:00:00.000Z", projectA).run();
    expect((await dispatch(viewerToken, `/projects/${projectA}/logs`)).status).toBe(200);
    expect((await dispatch(viewerToken, `/projects/${projectA}/logs?limit=201`)).status).toBe(400);
    expect((await dispatch(viewerToken, `/projects/${projectA}/logs?limit=0`)).status).toBe(400);
    expect(
      (await dispatch(viewerToken, `/projects/${projectA}/logs?cursor=not+a+cursor`)).status,
    ).toBe(400);
  });

  it("records field-level content changes without descriptions or attachment payloads", async () => {
    const nextBoard = board("new-private-description", {
      id: "attachment-new",
      type: "image/webp",
      fileName: "private-after.webp",
      bytes: "base64-secret-after",
    });
    const update = await dispatch(
      managerToken,
      `/projects/${projectA}/boards/${boardA}/content`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: 0, board: nextBoard }),
      },
    );
    expect(update.status).toBe(200);

    const response = await dispatch(
      viewerToken,
      `/projects/${projectA}/boards/${boardA}/logs`,
    );
    const body = await response.json() as {
      logs: Array<{
        action: string;
        metadata: {
          changes: Array<{ kind: string; fields?: string[] }>;
          counts: Record<string, number>;
          truncated: boolean;
        };
      }>;
    };
    const log = body.logs.find((item) => item.action === "board.content_updated");
    expect(log?.metadata.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "card.updated", fields: ["description"] }),
      expect.objectContaining({ kind: "attachment.added" }),
      expect.objectContaining({ kind: "attachment.removed" }),
    ]));
    expect(log?.metadata.counts).toMatchObject({
      "card.updated": 1,
      "attachment.added": 1,
      "attachment.removed": 1,
    });
    expect(log?.metadata.truncated).toBe(false);

    const serialized = JSON.stringify(body);
    for (const secret of [
      "old-private-description",
      "new-private-description",
      "private-before.png",
      "private-after.webp",
      "base64-secret-before",
      "base64-secret-after",
      managerToken,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("Activity Log board visibility (Task 3)", () => {
  beforeEach(async () => {
    await insertUser(contributorId, contributorToken);
    const now = "2026-07-27T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'contributor', ?, ?)`,
    ).bind(projectA, contributorId, now, now).run();
    // boardA2 的 updated_at 晚於外層 beforeEach 建立的 boardA，所以是 contributor
    // 無指派列時 fallback 到的主要看板；boardA 對 contributor 反而不可見。
    const later = "2026-07-27T00:30:00.000Z";
    await env.DB.prepare(
      `INSERT INTO boards (
         id, project_id, name, normalized_name, status, revision, data,
         created_by, created_at, updated_at, archived_at, archived_by
       ) VALUES (?, ?, 'Board A2', 'board a2', 'active', 0, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      boardA2, projectA, JSON.stringify({ version: 4, columns: [], cards: {} }),
      managerId, later, later,
    ).run();
  });

  it("rejects a non-visible Board's logs for a contributor, allows the fallback primary, and never restricts the owner", async () => {
    await insertLog("85000000-0000-4000-8000-000000000001", projectA, boardA, "2026-07-27T06:00:00.000Z");
    await insertLog("85000000-0000-4000-8000-000000000002", projectA, boardA2, "2026-07-27T06:01:00.000Z");

    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/logs`)).status,
    ).toBe(404);
    const fallback = await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA2}/logs`);
    expect(fallback.status).toBe(200);
    expect((await fallback.json() as { logs: Array<{ boardId: string | null }> }).logs).toHaveLength(1);
    expect(
      (await dispatch(managerToken, `/projects/${projectA}/boards/${boardA}/logs`)).status,
    ).toBe(200);

    // Task 5 的指派 API 尚未落地，直接寫入指派列模擬其效果：一旦指派，fallback 讓路。
    await env.DB.prepare(
      `INSERT INTO project_member_boards (project_id, user_id, board_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectA, contributorId, boardA, managerId, "2026-07-27T00:00:00.000Z").run();
    expect(
      (await dispatch(contributorToken, `/projects/${projectA}/boards/${boardA}/logs`)).status,
    ).toBe(200);
  });

  it("filters non-visible board-scoped events out of a contributor's project-scoped query while the owner keeps seeing all of them", async () => {
    await insertLog("85000000-0000-4000-8000-000000000010", projectA, boardA, "2026-07-27T06:10:00.000Z");
    await insertLog("85000000-0000-4000-8000-000000000011", projectA, boardA2, "2026-07-27T06:11:00.000Z");
    await insertLog("85000000-0000-4000-8000-000000000012", projectA, null, "2026-07-27T06:12:00.000Z");

    const contributorView = await dispatch(contributorToken, `/projects/${projectA}/logs`);
    expect(contributorView.status).toBe(200);
    const contributorBody = await contributorView.json() as { logs: Array<{ id: string }> };
    expect(contributorBody.logs.map((log) => log.id).sort()).toEqual([
      "85000000-0000-4000-8000-000000000011",
      "85000000-0000-4000-8000-000000000012",
    ].sort());

    const ownerView = await dispatch(managerToken, `/projects/${projectA}/logs`);
    const ownerBody = await ownerView.json() as { logs: Array<{ id: string }> };
    expect(ownerBody.logs.map((log) => log.id).sort()).toEqual([
      "85000000-0000-4000-8000-000000000010",
      "85000000-0000-4000-8000-000000000011",
      "85000000-0000-4000-8000-000000000012",
    ].sort());
  });

  it("strips an invisible Board's name and id from project-level event metadata for a contributor, but not for the owner", async () => {
    // project.created 是 project-level 事件（board_id 為 NULL），row 層級的可見性
    // 過濾對它一律放行；洩漏藏在 metadata.boardId/boardName 這個內嵌欄位，只能在
    // 序列化前額外處理。這裡把 metadata 指向 boardA（contributor 不可見）。
    const logId = "85000000-0000-4000-8000-000000000020";
    await insertProjectCreatedLog(
      logId, projectA, boardA, "Secret Initial Board Name", "2026-07-27T06:20:00.000Z",
    );

    const contributorView = await dispatch(contributorToken, `/projects/${projectA}/logs`);
    expect(contributorView.status).toBe(200);
    const contributorBody = await contributorView.json() as {
      logs: Array<{ id: string; metadata: Record<string, unknown> }>;
    };
    expect(JSON.stringify(contributorBody)).not.toContain("Secret Initial Board Name");
    expect(JSON.stringify(contributorBody)).not.toContain(boardA);
    const contributorEntry = contributorBody.logs.find((log) => log.id === logId);
    expect(contributorEntry).toBeDefined();
    expect(contributorEntry?.metadata).toEqual({ name: "Alpha", ownerUserId: managerId });

    const ownerView = await dispatch(managerToken, `/projects/${projectA}/logs`);
    expect(ownerView.status).toBe(200);
    const ownerBody = await ownerView.json() as {
      logs: Array<{ id: string; metadata: Record<string, unknown> }>;
    };
    const ownerEntry = ownerBody.logs.find((log) => log.id === logId);
    expect(ownerEntry?.metadata).toEqual({
      name: "Alpha", boardId: boardA, boardName: "Secret Initial Board Name", ownerUserId: managerId,
    });
  });
});
