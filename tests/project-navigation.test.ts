import assert from "node:assert/strict";
import test from "node:test";

import {
  boardBelongsToRoute,
  canViewManagerViews,
  deriveBoardAccess,
  parseProjectHash,
  resolveAuthorizedRoute,
  serializeProjectRoute,
} from "../app/projects/navigation";
import type { BoardMeta, ProjectSummary } from "../app/projects/types";

const projectId = "a0000000-0000-4000-8000-000000000001";
const otherProjectId = "a0000000-0000-4000-8000-000000000002";
const boardId = "a0000000-0000-4000-8000-000000000003";
const otherBoardId = "a0000000-0000-4000-8000-000000000004";
const workspaceId = "a0000000-0000-4000-8000-000000000005";

const projects: ProjectSummary[] = [{
  id: projectId,
  name: "Alpha",
  status: "active",
  myRole: "owner",
  activeBoardCount: 1,
  boardId,
  boardName: "Roadmap",
  lastActivityAt: null,
}];

const board: BoardMeta = {
  id: boardId,
  projectId,
  name: "Roadmap",
  status: "active",
  revision: 1,
  createdBy: workspaceId,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  archivedAt: null,
  archivedBy: null,
};

test("project hash routes parse and serialize as canonical round trips", () => {
  const routes = [
    { kind: "projects" } as const,
    { kind: "admin" } as const,
    { kind: "project", projectId } as const,
    { kind: "board", projectId, boardId } as const,
  ];
  for (const route of routes) {
    assert.deepEqual(parseProjectHash(serializeProjectRoute(route)), route);
  }
  assert.deepEqual(parseProjectHash(""), { kind: "projects" });
  assert.equal(parseProjectHash("#/projects/not-a-uuid"), null);
  assert.equal(parseProjectHash(`#/projects/${projectId}/boards/local:legacy-board`), null);
  assert.equal(parseProjectHash(`#/projects/${projectId}/unknown/${boardId}`), null);
});

test("platform administration route requires an explicit workspace capability", () => {
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "admin" }, projects, null, true),
    { kind: "admin" },
  );
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "admin" }, projects, null, false),
    { kind: "projects" },
  );
});

test("calendar hash route parses an optional month query and falls back on invalid formats", () => {
  assert.deepEqual(parseProjectHash("#/calendar"), { kind: "calendar", month: null });
  assert.deepEqual(
    parseProjectHash("#/calendar?month=2026-08"),
    { kind: "calendar", month: "2026-08" },
  );
  assert.deepEqual(
    parseProjectHash("#/calendar?month=2026-13"),
    { kind: "calendar", month: null },
  );
});

test("calendar route serializes with or without a month query", () => {
  assert.equal(
    serializeProjectRoute({ kind: "calendar", month: "2026-08" }),
    "#/calendar?month=2026-08",
  );
  assert.equal(serializeProjectRoute({ kind: "calendar", month: null }), "#/calendar");
});

test("parses the resources route with and without a from parameter", () => {
  assert.deepEqual(parseProjectHash("#/resources"), { kind: "resources", from: null });
  assert.deepEqual(
    parseProjectHash("#/resources?from=2026-08-07"),
    { kind: "resources", from: "2026-08-07" },
  );
  assert.deepEqual(
    parseProjectHash("#/resources?from=2026-8-7"),
    { kind: "resources", from: null },
  );
});

test("resources route rejects from dates that are not real calendar days", () => {
  // 正則形狀合法（YYYY-MM-DD、數字範圍也對）但曆法上不存在——isValidDay 的
  // 來回驗證才擋得下來，單靠 /^\d{4}-\d{2}-\d{2}$/ 這類形狀正則會誤放行，
  // 讓 rangeFrom 在 Task 6 直接拿到這個值時於 toISOString() 溢位或拋例外。
  assert.deepEqual(
    parseProjectHash("#/resources?from=2026-02-30"),
    { kind: "resources", from: null },
  );
  assert.deepEqual(
    parseProjectHash("#/resources?from=2027-02-29"),
    { kind: "resources", from: null },
  );
  // 閏年 2 月 29 日是合法的一天，不該被誤擋。
  assert.deepEqual(
    parseProjectHash("#/resources?from=2028-02-29"),
    { kind: "resources", from: "2028-02-29" },
  );
});

test("serializes the resources route", () => {
  assert.equal(
    serializeProjectRoute({ kind: "resources", from: "2026-08-07" }),
    "#/resources?from=2026-08-07",
  );
  assert.equal(serializeProjectRoute({ kind: "resources", from: null }), "#/resources");
});

test("canViewManagerViews allows a workspace admin/owner or the owner of any active project", () => {
  assert.equal(canViewManagerViews([], true), true);
  assert.equal(canViewManagerViews(projects, false), true);

  // owner 角色成立，但專案已封存——archived owner 不算，與 Worker 端
  // resolveCalendarScope 的 `projects.status = 'active'` 篩選一致。
  const archivedOwnerProjects: ProjectSummary[] = [{ ...projects[0], status: "archived" }];
  assert.equal(canViewManagerViews(archivedOwnerProjects, false), false);

  // 只是 active 專案的 member，不是 owner——不成立。
  const memberOnlyProjects: ProjectSummary[] = [{ ...projects[0], myRole: "member" }];
  assert.equal(canViewManagerViews(memberOnlyProjects, false), false);
});

test("calendar route falls back to #/projects unless admin or an active project owner", () => {
  // admin：即使完全沒有專案，仍保留 calendar 路由（等同 admin 路由的邏輯）。
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "calendar", month: null }, [], null, true),
    { kind: "calendar", month: null },
  );
  // 非 admin，但在某個 active 專案是 owner——保留 calendar 路由。
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "calendar", month: "2026-08" }, projects, null, false),
    { kind: "calendar", month: "2026-08" },
  );
  // 非 admin，owner 的專案已封存——導回 #/projects。
  const archivedOwnerProjects: ProjectSummary[] = [{ ...projects[0], status: "archived" }];
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "calendar", month: null }, archivedOwnerProjects, null, false),
    { kind: "projects" },
  );
  // 非 admin，且所有專案都只是 member 角色——導回 #/projects。
  const memberOnlyProjects: ProjectSummary[] = [{ ...projects[0], myRole: "member" }];
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "calendar", month: null }, memberOnlyProjects, null, false),
    { kind: "projects" },
  );
});

test("resources route follows the same gate as the calendar", () => {
  const ownerProjects = [
    { id: "p1", name: "A", status: "active", myRole: "owner" } as ProjectSummary,
  ];
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "resources", from: null }, ownerProjects, null, false),
    { kind: "resources", from: null },
  );
  const memberProjects = [
    { id: "p1", name: "A", status: "active", myRole: "member" } as ProjectSummary,
  ];
  assert.deepEqual(
    resolveAuthorizedRoute({ kind: "resources", from: null }, memberProjects, null, false),
    { kind: "projects" },
  );
});

test("unauthorized or malformed routes fall back to a valid recent context, then projects", () => {
  const lastContext = { workspaceId, projectId, boardId };
  assert.deepEqual(
    resolveAuthorizedRoute(
      { kind: "project", projectId: otherProjectId },
      projects,
      lastContext,
    ),
    { kind: "board", projectId, boardId },
  );
  assert.deepEqual(resolveAuthorizedRoute(null, projects), { kind: "projects" });
  assert.deepEqual(
    resolveAuthorizedRoute(
      { kind: "board", projectId, boardId },
      projects,
    ),
    { kind: "board", projectId, boardId },
  );
});

test("board route validation rejects a board from another project", () => {
  assert.equal(
    boardBelongsToRoute({ kind: "board", projectId, boardId }, [board]),
    true,
  );
  assert.equal(
    boardBelongsToRoute(
      { kind: "board", projectId, boardId: otherBoardId },
      [board],
    ),
    false,
  );
});

test("role and archive state produce the visible Board actions", () => {
  assert.deepEqual(deriveBoardAccess("owner", "active", "active"), {
    canEdit: true,
    canConfigureWorkflow: true,
    canWriteAttachments: true,
    canManageAssignments: true,
    readOnlyReason: null,
  });
  assert.deepEqual(deriveBoardAccess("member", "active", "active"), {
    canEdit: true,
    canConfigureWorkflow: false,
    canWriteAttachments: true,
    canManageAssignments: false,
    readOnlyReason: null,
  });
  assert.equal(deriveBoardAccess("viewer", "active", "active").canEdit, false);
  assert.match(
    deriveBoardAccess("owner", "active", "archived").readOnlyReason ?? "",
    /看板已封存/,
  );
  assert.match(
    deriveBoardAccess("owner", "archived", "active").readOnlyReason ?? "",
    /專案已封存/,
  );
});

test("deriveBoardAccess grants assignment management only to the project owner", () => {
  assert.equal(deriveBoardAccess("owner", "active", "active").canManageAssignments, true);
  assert.equal(deriveBoardAccess("member", "active", "active").canManageAssignments, false);
  assert.equal(deriveBoardAccess("owner", "archived", "active").canManageAssignments, false);
  // 看板本身封存（專案仍 active）：即使角色是 owner，也不能開放指派管理入口，
  // 否則 UI 會讓人以為可以操作，實際送出去會被 Worker 端 403。
  assert.equal(deriveBoardAccess("owner", "active", "archived").canManageAssignments, false);
  // viewer 角色本來就不能編輯看板內容，指派管理不能是唯一的例外。
  assert.equal(deriveBoardAccess("viewer", "active", "active").canManageAssignments, false);
});
