import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../src/logic";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const endpoint = "https://sync.test";
const workspaceId = "91000000-0000-4000-8000-000000000001";
const managerId = "91000000-0000-4000-8000-000000000002";
const contributorId = "91000000-0000-4000-8000-000000000003";
const viewerId = "91000000-0000-4000-8000-000000000004";
const outsiderId = "91000000-0000-4000-8000-000000000005";
const projectA = "92000000-0000-4000-8000-000000000001";
const projectB = "92000000-0000-4000-8000-000000000002";
const boardA = "93000000-0000-4000-8000-000000000001";
const boardA2 = "93000000-0000-4000-8000-000000000002";
const boardB = "93000000-0000-4000-8000-000000000003";
const attachmentId = "att-94000000-0000-4000-8000-000000000001";
const managerToken = "task8-manager-runtime-token-long-value";
const contributorToken = "task8-contributor-runtime-token-long-value";
const viewerToken = "task8-viewer-runtime-token-long-value";
const outsiderToken = "task8-outsider-runtime-token-long-value";
const maxAttachmentBytes = 10 * 1024 * 1024;

function attachmentPath(
  projectId = projectA,
  boardId = boardA,
  id = attachmentId,
) {
  return `/projects/${projectId}/boards/${boardId}/attachments/${id}`;
}

async function dispatch(
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
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

async function clearAttachments() {
  let cursor: string | undefined;
  let truncated = true;
  while (truncated) {
    const result = await env.ATTACHMENTS.list({ cursor });
    if (result.objects.length) {
      await env.ATTACHMENTS.delete(result.objects.map((object) => object.key));
    }
    truncated = result.truncated;
    cursor = result.truncated ? result.cursor : undefined;
  }
}

async function upload(
  token: string,
  content: Uint8Array<ArrayBuffer>,
  projectId = projectA,
  boardId = boardA,
  id = attachmentId,
) {
  return dispatch(token, attachmentPath(projectId, boardId, id), {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: content,
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
    "CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL, default_workspace_id TEXT, legacy_project_id TEXT, legacy_board_id TEXT, locked_at TEXT, completed_at TEXT, updated_at TEXT, error TEXT)",
    // migration 0005：看板指派表（Task 3 起 attachments 會透過 board-access.ts
    // 查詢此表決定 contributor 可見範圍；resolveVisibleBoardIds 的 fallback 分支
    // 仍會 SELECT 這張表，即使沒有任何指派列，表不存在就會直接噴 SQL 錯誤）。
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
    "CREATE INDEX IF NOT EXISTS task8_project_member_boards_user_idx ON project_member_boards(project_id, user_id)",
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
});

beforeEach(async () => {
  await clearAttachments();
  for (const table of [
    "project_member_boards", "boards", "project_members", "projects", "workspace_members",
    "workspaces", "access_tokens", "user_accounts", "migration_state",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await insertUser(managerId, managerToken);
  await insertUser(contributorId, contributorToken);
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
            (?, ?, 'contributor', ?, ?),
            (?, ?, 'viewer', ?, ?),
            (?, ?, 'manager', ?, ?)`,
  ).bind(
    projectA, managerId, now, now,
    projectA, contributorId, now, now,
    projectA, viewerId, now, now,
    projectB, outsiderId, now, now,
  ).run();
  const emptyBoard = JSON.stringify({ version: 4, columns: [], cards: {} });
  await env.DB.prepare(
    `INSERT INTO boards (
       id, project_id, name, normalized_name, status, revision, data,
       created_by, created_at, updated_at, archived_at, archived_by
     ) VALUES (?, ?, 'A1', 'a1', 'active', 0, ?, ?, ?, ?, NULL, NULL),
              (?, ?, 'A2', 'a2', 'active', 0, ?, ?, ?, ?, NULL, NULL),
              (?, ?, 'B', 'b', 'active', 0, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    boardA, projectA, emptyBoard, managerId, now, now,
    boardA2, projectA, emptyBoard, managerId, now, now,
    boardB, projectB, emptyBoard, outsiderId, now, now,
  ).run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Project/Board-scoped Attachment API", () => {
  it("allows managers and contributors to mutate while viewers remain read-only", async () => {
    // Board 可見性 v1：boardA2 的 updated_at 與 boardA 相同、id 較大，是 contributor
    // 無指派列時 fallback 到的主要看板；boardA 反而不可見。這裡測的是角色能力
    // （manager/contributor 可寫、viewer 只讀），與可見性無關，故明確指派 contributor
    // 到 boardA（預設 attachmentPath）。
    await assignBoard(projectA, contributorId, boardA);
    const content = new Uint8Array([1, 2, 3, 4]);
    expect((await upload(contributorToken, content)).status).toBe(200);

    const get = await dispatch(viewerToken, attachmentPath());
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/jpeg");
    expect(get.headers.get("Content-Length")).toBe(String(content.byteLength));
    expect(get.headers.get("ETag")).toMatch(/^".+"$/);
    expect(get.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(get.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(content);

    expect((await upload(viewerToken, new Uint8Array([9]))).status).toBe(403);
    expect(
      (await dispatch(viewerToken, attachmentPath(), { method: "DELETE" })).status,
    ).toBe(403);
    expect((await upload(managerToken, new Uint8Array([5]))).status).toBe(200);
    expect(
      (await dispatch(contributorToken, attachmentPath(), { method: "DELETE" })).status,
    ).toBe(200);
    expect((await dispatch(viewerToken, attachmentPath())).status).toBe(404);
  });

  it("builds distinct server-side keys for the same attachment ID in each Board", async () => {
    expect((await upload(managerToken, new Uint8Array([1]), projectA, boardA)).status).toBe(200);
    expect((await upload(managerToken, new Uint8Array([2]), projectA, boardA2)).status).toBe(200);
    expect((await upload(outsiderToken, new Uint8Array([3]), projectB, boardB)).status).toBe(200);

    const a1 = await dispatch(viewerToken, attachmentPath(projectA, boardA));
    const a2 = await dispatch(viewerToken, attachmentPath(projectA, boardA2));
    const b = await dispatch(outsiderToken, attachmentPath(projectB, boardB));
    expect([...new Uint8Array(await a1.arrayBuffer())]).toEqual([1]);
    expect([...new Uint8Array(await a2.arrayBuffer())]).toEqual([2]);
    expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([3]);

    const listed = await env.ATTACHMENTS.list();
    expect(listed.objects.map((object) => object.key).sort()).toEqual([
      `workspaces/${workspaceId}/projects/${projectA}/boards/${boardA}/attachments/${attachmentId}`,
      `workspaces/${workspaceId}/projects/${projectA}/boards/${boardA2}/attachments/${attachmentId}`,
      `workspaces/${workspaceId}/projects/${projectB}/boards/${boardB}/attachments/${attachmentId}`,
    ].sort());
  });

  it("returns authorization failures before touching R2", async () => {
    const get = vi.spyOn(env.ATTACHMENTS, "get");
    const put = vi.spyOn(env.ATTACHMENTS, "put");
    const remove = vi.spyOn(env.ATTACHMENTS, "delete");

    expect(
      (await dispatch(managerToken, attachmentPath(projectA, boardB))).status,
    ).toBe(404);
    expect(
      (await dispatch(outsiderToken, attachmentPath(projectA, boardA))).status,
    ).toBe(404);
    expect(
      (await upload(managerToken, new Uint8Array([1]), projectA, boardB)).status,
    ).toBe(404);
    expect(
      (await dispatch(viewerToken, attachmentPath(), {
        method: "DELETE",
      })).status,
    ).toBe(403);
    // Board 可見性 v1：contributor 對無指派列、非主要看板的 boardA 沒有可見權，
    // 一樣要在碰 R2 之前被擋下。
    expect(
      (await dispatch(contributorToken, attachmentPath(projectA, boardA))).status,
    ).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("hides an unassigned Board's attachments from a contributor while the fallback primary Board and the owner stay reachable", async () => {
    // Board 可見性 v1：boardA、boardA2 都在 projectA，updated_at 相同時以 id 較大者
    // 為主要看板，所以 boardA2 是 contributor 無指派列時的 fallback；boardA 不可見。
    const content = new Uint8Array([42]);
    expect((await upload(managerToken, content, projectA, boardA)).status).toBe(200);
    expect((await upload(managerToken, content, projectA, boardA2)).status).toBe(200);

    expect((await upload(contributorToken, content, projectA, boardA)).status).toBe(404);
    expect(
      (await dispatch(contributorToken, attachmentPath(projectA, boardA))).status,
    ).toBe(404);
    expect(
      (await dispatch(contributorToken, attachmentPath(projectA, boardA), {
        method: "DELETE",
      })).status,
    ).toBe(404);

    expect((await upload(contributorToken, content, projectA, boardA2)).status).toBe(200);
    expect(
      (await dispatch(contributorToken, attachmentPath(projectA, boardA2))).status,
    ).toBe(200);
    expect(
      (await dispatch(contributorToken, attachmentPath(projectA, boardA2), {
        method: "DELETE",
      })).status,
    ).toBe(200);

    expect((await dispatch(managerToken, attachmentPath(projectA, boardA))).status).toBe(200);
    expect(
      (await dispatch(managerToken, attachmentPath(projectA, boardA), {
        method: "DELETE",
      })).status,
    ).toBe(200);
  });

  it("keeps archived attachments readable but rejects all mutations", async () => {
    // Board 可見性 v1：同上，contributor 無指派列時看不到 boardA，這裡測的是封存
    // 狀態的權限（archived 一律拒絕變更），與可見性無關，故明確指派。
    await assignBoard(projectA, contributorId, boardA);
    const original = new Uint8Array([4, 5, 6]);
    expect((await upload(managerToken, original)).status).toBe(200);
    const archivedAt = "2026-07-27T02:00:00.000Z";
    await env.DB.prepare(
      "UPDATE boards SET status = 'archived', archived_at = ?, archived_by = ? WHERE id = ?",
    ).bind(archivedAt, managerId, boardA).run();
    expect((await dispatch(viewerToken, attachmentPath())).status).toBe(200);
    expect((await upload(contributorToken, new Uint8Array([9]))).status).toBe(409);
    expect(
      (await dispatch(managerToken, attachmentPath(), { method: "DELETE" })).status,
    ).toBe(409);

    await env.DB.prepare(
      "UPDATE boards SET status = 'active', archived_at = NULL, archived_by = NULL WHERE id = ?",
    ).bind(boardA).run();
    await env.DB.prepare(
      "UPDATE projects SET status = 'archived', archived_at = ?, archived_by = ? WHERE id = ?",
    ).bind(archivedAt, managerId, projectA).run();
    const archivedProjectGet = await dispatch(viewerToken, attachmentPath());
    expect(archivedProjectGet.status).toBe(200);
    expect(new Uint8Array(await archivedProjectGet.arrayBuffer())).toEqual(original);
    expect((await upload(managerToken, new Uint8Array([8]))).status).toBe(409);
  });

  it("rejects invalid IDs, unsupported MIME, empty bodies, and oversized uploads", async () => {
    expect(
      (await dispatch(managerToken, attachmentPath(projectA, boardA, "%2F"), {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array([1]),
      })).status,
    ).toBe(400);
    expect(
      (await dispatch(managerToken, attachmentPath(projectA, boardA, "file.jpeg"), {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array([1]),
      })).status,
    ).toBe(400);
    expect(
      (await dispatch(managerToken, attachmentPath(), {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: "x",
      })).status,
    ).toBe(415);
    expect(
      (await dispatch(managerToken, attachmentPath(), {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: "",
      })).status,
    ).toBe(400);
    expect(
      (await dispatch(managerToken, attachmentPath(), {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(maxAttachmentBytes + 1),
        },
        body: new Uint8Array([1]),
      })).status,
    ).toBe(413);
    expect(
      (await dispatch(managerToken, attachmentPath(), {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(maxAttachmentBytes + 1));
            controller.close();
          },
        }),
      })).status,
    ).toBe(413);
  });

  it("accepts the exact 10 MiB boundary and keeps the legacy file-name route disabled", async () => {
    const content = new Uint8Array(maxAttachmentBytes);
    content[0] = 7;
    content[content.length - 1] = 8;
    expect((await upload(managerToken, content)).status).toBe(200);
    const get = await dispatch(viewerToken, attachmentPath());
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Length")).toBe(String(maxAttachmentBytes));
    const downloaded = new Uint8Array(await get.arrayBuffer());
    expect(downloaded[0]).toBe(7);
    expect(downloaded[downloaded.length - 1]).toBe(8);
    expect((await dispatch(managerToken, "/attachments/legacy.jpeg")).status).toBe(404);
  });

  it("does not touch R2 before migration completes and preserves the error envelope", async () => {
    await env.DB.prepare("UPDATE migration_state SET status = 'pending' WHERE id = 1").run();
    const get = vi.spyOn(env.ATTACHMENTS, "get");
    expect((await dispatch(viewerToken, attachmentPath())).status).toBe(503);
    expect(get).not.toHaveBeenCalled();

    await env.DB.prepare("UPDATE migration_state SET status = 'complete' WHERE id = 1").run();
    get.mockRejectedValueOnce(new Error("R2 is unavailable"));
    const failure = await dispatch(viewerToken, attachmentPath());
    expect(failure.status).toBe(500);
    expect(await failure.json()).toMatchObject({ error: "internal error" });
    expect(failure.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(failure.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("advertises scoped upload requirements in unauthenticated CORS preflight", async () => {
    const response = await dispatch(null, attachmentPath(), { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-Request-Id");
  });
});
