import assert from "node:assert/strict";
import test from "node:test";

import { createDemoBoard } from "../app/board-model";
import {
  ApiClientError,
  archiveBoard,
  archiveAdminProject,
  createProject,
  getAssignments,
  getBoard,
  getCalendar,
  getProject,
  getProjectSummary,
  listBoards,
  listBoardLogs,
  listMemberBoards,
  listProjectLogs,
  listProjectMembers,
  listAdminProjects,
  listAdminUserProjects,
  listProjects,
  putMemberBoards,
  requestJson,
  restoreBoard,
} from "../app/projects/api";
import type { BoardContext } from "../app/projects/types";
import { fetchRemoteBoard, pushRemoteBoard } from "../app/sync/api";

const config = { baseUrl: "https://sync.example", token: "client-test-token" };
const context: BoardContext = {
  workspaceId: "a0000000-0000-4000-8000-000000000001",
  projectId: "a0000000-0000-4000-8000-000000000002",
  boardId: "a0000000-0000-4000-8000-000000000003",
};
const userId = "a0000000-0000-4000-8000-000000000004";
const logId = "a0000000-0000-4000-8000-000000000005";
const board = createDemoBoard(new Date("2026-07-27T00:00:00.000Z"));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: context.projectId,
    workspaceId: context.workspaceId,
    name: "Alpha",
    status: "active",
    myRole: "owner",
    createdBy: userId,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

function boardMeta(overrides: Record<string, unknown> = {}) {
  return {
    id: context.boardId,
    projectId: context.projectId,
    name: "Roadmap",
    status: "active",
    revision: 3,
    createdBy: userId,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

test("Board v2 fetch/push requires context and uses the nested content path", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ url: String(input), method, body: requestBody });
    if (method === "PUT") {
      return json({ revision: 4, board }, 409);
    }
    return json({
      board: {
        ...boardMeta(),
        content: { revision: 3, board },
      },
    });
  };
  try {
    const remote = await fetchRemoteBoard(config, context);
    assert.equal(remote.revision, 3);
    assert.equal(remote.board.version, 8);

    const conflict = await pushRemoteBoard(config, context, 3, board);
    assert.equal(conflict.kind, "conflict");
    assert.equal(conflict.revision, 4);
    assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
      {
        url: `https://sync.example/projects/${context.projectId}/boards/${context.boardId}`,
        method: "GET",
      },
      {
        url: `https://sync.example/projects/${context.projectId}/boards/${context.boardId}/content`,
        method: "PUT",
      },
    ]);
    assert.deepEqual(requests[1].body, { baseRevision: 3, board });

    await assert.rejects(
      () => getBoard(config, { ...context, boardId: "local:legacy-board" }),
      (error: unknown) =>
        error instanceof ApiClientError && error.code === "invalid_board_id",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Project, member, summary, and Board Log clients strictly parse server responses", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    if (url.pathname === "/projects") {
      return json({
        projects: [{
          id: context.projectId,
          name: "Alpha",
          status: "active",
          myRole: "owner",
          activeBoardCount: 1,
          boardId: context.boardId,
          boardName: "Roadmap",
          lastActivityAt: null,
        }],
      });
    }
    if (url.pathname.endsWith("/members")) {
      return json({
        members: [{
          userId,
          displayName: "Manager",
          role: "owner",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
        }],
      });
    }
    if (url.pathname.endsWith("/summary")) {
      return json({
        projectId: context.projectId,
        summary: {
          includeArchived: true,
          boardCount: 1,
          stats: { total: 2, active: 1, completed: 1, overdue: 0 },
          monthlyCompletions: [{ month: "2026-07", monthLabel: "2026 年 7 月", count: 1 }],
          boards: [{
            id: context.boardId,
            name: "Roadmap",
            status: "active",
            revision: 3,
            stats: { total: 2, active: 1, completed: 1, overdue: 0 },
          }],
          generatedAt: "2026-07-27T00:00:00.000Z",
          timeZone: "Asia/Taipei",
        },
      });
    }
    if (url.pathname.endsWith("/logs")) {
      return json({
        logs: [{
          id: logId,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          boardId: context.boardId,
          actorUserId: userId,
          action: "board.content_updated",
          entityType: "board",
          entityId: context.boardId,
          revision: 3,
          metadata: {},
          occurredAt: "2026-07-27T00:00:00.000Z",
        }],
        nextCursor: "next/cursor+value=",
      });
    }
    return json({ project: project() });
  };
  try {
    assert.equal((await listProjects(config))[0].id, context.projectId);
    assert.equal((await getProject(config, context.projectId)).myRole, "owner");
    assert.equal((await listProjectMembers(config, context.projectId))[0].displayName, "Manager");
    assert.equal((await getProjectSummary(config, context.projectId, true)).stats.total, 2);
    const logs = await listBoardLogs(config, context, {
      limit: 50,
      cursor: "cursor/with+symbols=",
    });
    assert.equal(logs.logs[0].boardId, context.boardId);
    assert.match(
      urls.at(-1) ?? "",
      /limit=50&cursor=cursor%2Fwith%2Bsymbols%3D$/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("platform registry client accepts metadata only and rejects malformed owner ids", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({
    projects: [{
      id: context.projectId,
      workspaceId: context.workspaceId,
      name: "Alpha",
      status: "active",
      ownerIds: [userId],
      boardId: context.boardId,
      boardName: "Roadmap",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    }],
  });
  try {
    const projects = await listAdminProjects(config);
    assert.equal(projects[0].workspaceId, context.workspaceId);
    assert.deepEqual(projects[0].ownerIds, [userId]);

    globalThis.fetch = async () => json({
      projects: [{ ...projects[0], ownerIds: ["invalid"] }],
    });
    await assert.rejects(
      () => listAdminProjects(config),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Project creation sends the Board and accepts an admin creator without membership", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return json({
      project: project({ myRole: undefined }),
      board: boardMeta({ revision: 0 }),
      myRole: null,
    }, 201);
  };
  try {
    const created = await createProject(config, {
      id: context.projectId,
      workspaceId: context.workspaceId,
      name: "Alpha",
      boardId: context.boardId,
      boardName: "Roadmap",
      board,
      ownerUserId: userId,
    });
    assert.equal(created.myRole, null);
    assert.equal(created.board.id, context.boardId);
    assert.equal(requestBodies[0]?.ownerUserId, userId);
    assert.deepEqual(requestBodies[0]?.board, board);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("platform archive uses the metadata-only admin route", async () => {
  const originalFetch = globalThis.fetch;
  let request: { path: string; method: string } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { path: new URL(String(input)).pathname, method: init?.method ?? "GET" };
    return json({ ok: true });
  };
  try {
    await archiveAdminProject(config, context.projectId);
    assert.deepEqual(request, {
      path: `/admin/projects/${context.projectId}/archive`,
      method: "POST",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps 401, 403, 404, conflict, and archived conflict consistently", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    [401, "unauthorized", "unauthorized"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [409, "name_conflict", "conflict"],
    [409, "resource_archived", "resource_archived"],
  ] as const;
  try {
    for (const [status, code, kind] of cases) {
      globalThis.fetch = async () => json({ error: code }, status);
      await assert.rejects(
        () => requestJson(config, "/test", "測試操作"),
        (error: unknown) =>
          error instanceof ApiClientError &&
          error.status === status &&
          error.kind === kind &&
          error.code === code,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Board list/archive/restore and Project Log use their exact nested methods and paths", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.toString(), method: init?.method ?? "GET" });
    if (url.pathname.endsWith("/logs")) {
      return json({ logs: [], nextCursor: null });
    }
    if (url.pathname.endsWith("/boards")) {
      return json({ boards: [boardMeta()] });
    }
    const archived = url.pathname.endsWith("/archive");
    return json({
      board: boardMeta(archived ? {
        status: "archived",
        archivedAt: "2026-07-27T01:00:00.000Z",
        archivedBy: userId,
      } : {}),
    });
  };
  try {
    assert.equal((await listBoards(config, context.projectId))[0].id, context.boardId);
    assert.equal((await archiveBoard(config, context)).status, "archived");
    assert.equal((await restoreBoard(config, context)).status, "active");
    assert.deepEqual(await listProjectLogs(config, context.projectId), {
      logs: [],
      nextCursor: null,
    });
    assert.deepEqual(requests, [
      {
        url: `https://sync.example/projects/${context.projectId}/boards?status=active`,
        method: "GET",
      },
      {
        url: `https://sync.example/projects/${context.projectId}/boards/${context.boardId}/archive`,
        method: "POST",
      },
      {
        url: `https://sync.example/projects/${context.projectId}/boards/${context.boardId}/restore`,
        method: "POST",
      },
      {
        url: `https://sync.example/projects/${context.projectId}/logs`,
        method: "GET",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed Project, Board, conflict, and list payloads", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ project: project({ id: "not-a-uuid" }) });
    await assert.rejects(
      () => getProject(config, context.projectId),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({
      board: {
        ...boardMeta(),
        content: { revision: 3, board: { version: 999, columns: [], cards: {} } },
      },
    });
    await assert.rejects(
      () => getBoard(config, context),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({ revision: "4", board }, 409);
    await assert.rejects(
      () => pushRemoteBoard(config, context, 3, board),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({ error: "resource_archived" }, 409);
    await assert.rejects(
      () => pushRemoteBoard(config, context, 3, board),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "resource_archived",
    );

    globalThis.fetch = async () => json({
      projects: [{
        id: "invalid",
        name: "Bad",
        status: "active",
        myRole: "viewer",
        activeBoardCount: 0,
        lastActivityAt: null,
      }],
    });
    await assert.rejects(
      () => listProjects(config),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({
      projectId: context.projectId,
      summary: {
        includeArchived: false,
        boardCount: 0,
        stats: { total: 0, active: 0, completed: 0, overdue: 0 },
        monthlyCompletions: [{
          month: 202607,
          monthLabel: "2026 年 7 月",
          count: 0,
        }],
        boards: [],
        generatedAt: "2026-07-27T00:00:00.000Z",
        timeZone: "Asia/Taipei",
      },
    });
    await assert.rejects(
      () => getProjectSummary(config, context.projectId),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("member board assignment client fetches and updates the boardIds array", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const requestBody = typeof init?.body === "string"
      ? JSON.parse(init.body) as unknown
      : null;
    requests.push({ url: String(input), method, body: requestBody });
    return json({ boardIds: [context.boardId], requestId: "r" });
  };
  try {
    const listed = await listMemberBoards(config, context.projectId, userId);
    assert.deepEqual(listed, [context.boardId]);

    const updated = await putMemberBoards(config, context.projectId, userId, [context.boardId]);
    assert.deepEqual(updated, [context.boardId]);

    assert.deepEqual(requests, [
      {
        url: `https://sync.example/projects/${context.projectId}/members/${userId}/boards`,
        method: "GET",
        body: null,
      },
      {
        url: `https://sync.example/projects/${context.projectId}/members/${userId}/boards`,
        method: "PUT",
        body: { boardIds: [context.boardId] },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("member board assignment client rejects malformed boardIds payloads", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ requestId: "r" });
    await assert.rejects(
      () => listMemberBoards(config, context.projectId, userId),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({ boardIds: [1], requestId: "r" });
    await assert.rejects(
      () => putMemberBoards(config, context.projectId, userId, [context.boardId]),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAdminUserProjects fetches a user's project memberships scoped by workspace", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return json({
      userId,
      memberships: [{
        projectId: context.projectId,
        projectName: "專案 A",
        role: "owner",
        status: "active",
      }],
      requestId: "r",
    });
  };
  try {
    const memberships = await listAdminUserProjects(config, context.workspaceId, userId);
    assert.deepEqual(memberships, [{
      projectId: context.projectId,
      projectName: "專案 A",
      role: "owner",
      status: "active",
    }]);
    assert.deepEqual(requests, [{
      url: `https://sync.example/admin/users/${userId}/projects?workspaceId=${context.workspaceId}`,
      method: "GET",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAdminUserProjects accepts an empty memberships array", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ userId, memberships: [], requestId: "r" });
  try {
    const memberships = await listAdminUserProjects(config, context.workspaceId, userId);
    assert.deepEqual(memberships, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listAdminUserProjects rejects missing memberships or unknown role/status values", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ userId, requestId: "r" });
    await assert.rejects(
      () => listAdminUserProjects(config, context.workspaceId, userId),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({
      userId,
      memberships: [{
        projectId: context.projectId,
        projectName: "專案 A",
        role: "editor",
        status: "active",
      }],
      requestId: "r",
    });
    await assert.rejects(
      () => listAdminUserProjects(config, context.workspaceId, userId),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({
      userId,
      memberships: [{
        projectId: context.projectId,
        projectName: "專案 A",
        role: "owner",
        status: "pending",
      }],
      requestId: "r",
    });
    await assert.rejects(
      () => listAdminUserProjects(config, context.workspaceId, userId),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function calendarCard(overrides: Record<string, unknown> = {}) {
  return {
    cardId: "card-1",
    title: "撰寫報告",
    dueDate: "2026-08-15",
    assigneeUserIds: [userId],
    projectId: context.projectId,
    projectName: "Alpha",
    boardId: context.boardId,
    boardName: "Roadmap",
    blocked: false,
    serviceClass: "standard",
    ...overrides,
  };
}

test("getCalendar parses scheduled/unscheduled cards, flags, and assignees from a GET request", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return json({
      month: "2026-08",
      scope: "workspace",
      scheduled: [calendarCard()],
      unscheduled: [calendarCard({ cardId: "card-2", dueDate: "", blocked: true, serviceClass: "expedite" })],
      unscheduledTruncated: false,
      boardsTruncated: true,
      assignees: [{ userId, displayName: "Manager" }],
      requestId: "r",
    });
  };
  try {
    const calendar = await getCalendar(config, context.workspaceId, "2026-08");
    assert.equal(calendar.month, "2026-08");
    assert.equal(calendar.scope, "workspace");
    assert.equal(calendar.scheduled.length, 1);
    assert.deepEqual(calendar.scheduled[0], calendarCard());
    assert.equal(calendar.unscheduled.length, 1);
    assert.equal(calendar.unscheduled[0].dueDate, "");
    assert.equal(calendar.unscheduled[0].blocked, true);
    assert.equal(calendar.unscheduledTruncated, false);
    assert.equal(calendar.boardsTruncated, true);
    assert.deepEqual(calendar.assignees, [{ userId, displayName: "Manager" }]);
    assert.deepEqual(requests, [{
      url: `https://sync.example/calendar?workspaceId=${context.workspaceId}&month=2026-08`,
      method: "GET",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getCalendar rejects a response missing scheduled or carrying an unknown serviceClass", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({
      month: "2026-08",
      scope: "workspace",
      unscheduled: [],
      unscheduledTruncated: false,
      boardsTruncated: false,
      assignees: [],
      requestId: "r",
    });
    await assert.rejects(
      () => getCalendar(config, context.workspaceId, "2026-08"),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );

    globalThis.fetch = async () => json({
      month: "2026-08",
      scope: "workspace",
      scheduled: [calendarCard({ serviceClass: "urgent" })],
      unscheduled: [],
      unscheduledTruncated: false,
      boardsTruncated: false,
      assignees: [],
      requestId: "r",
    });
    await assert.rejects(
      () => getCalendar(config, context.workspaceId, "2026-08"),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const WORKSPACE_ID = context.workspaceId;
const ALICE = "a0000000-0000-4000-8000-000000000006";

const VALID_BAR = {
  userId: ALICE,
  cardId: "c1",
  title: "共同任務",
  startDate: "2026-08-07",
  endDate: "2026-08-13",
  projectId: "p1",
  projectName: "覓夜",
  boardId: "b1",
  boardName: "主看板",
  blocked: false,
  serviceClass: "standard",
};

const VALID_BODY = {
  from: "2026-08-07",
  to: "2026-08-20",
  scope: "workspace",
  people: [{ userId: ALICE, displayName: "律師甲" }],
  bars: [VALID_BAR],
  unscheduled: [],
  barsTruncated: false,
  unscheduledTruncated: false,
  boardsTruncated: false,
  requestId: "req-1",
};

test("getAssignments parses a well-formed response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json(VALID_BODY);
  try {
    const data = await getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20");
    assert.equal(data.scope, "workspace");
    assert.deepEqual(data.people, [{ userId: ALICE, displayName: "律師甲" }]);
    assert.equal(data.bars.length, 1);
    assert.equal(data.bars[0].endDate, "2026-08-13");
    assert.equal(data.boardsTruncated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAssignments rejects a bar missing startDate", async () => {
  const originalFetch = globalThis.fetch;
  const bad = { ...VALID_BAR };
  delete (bad as Record<string, unknown>).startDate;
  globalThis.fetch = async () => json({ ...VALID_BODY, bars: [bad] });
  try {
    await assert.rejects(
      () => getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20"),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAssignments rejects a non-array people field", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ ...VALID_BODY, people: "nope" });
  try {
    await assert.rejects(
      () => getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20"),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAssignments rejects an unknown scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ ...VALID_BODY, scope: "everything" });
  try {
    await assert.rejects(
      () => getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20"),
      (error: unknown) =>
        error instanceof ApiClientError && error.kind === "invalid_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAssignments sends workspaceId, from and to as query parameters", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    return json(VALID_BODY);
  };
  try {
    await getAssignments(config, WORKSPACE_ID, "2026-08-07", "2026-08-20");
    assert.match(requested, /\/assignments\?/);
    assert.match(requested, new RegExp(`workspaceId=${WORKSPACE_ID}`));
    assert.match(requested, /from=2026-08-07/);
    assert.match(requested, /to=2026-08-20/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
