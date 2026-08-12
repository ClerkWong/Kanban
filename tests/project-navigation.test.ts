import assert from "node:assert/strict";
import test from "node:test";

import {
  boardBelongsToRoute,
  canViewCalendar,
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

test("canViewCalendar allows a workspace admin/owner or the owner of any active project", () => {
  assert.equal(canViewCalendar([], true), true);
  assert.equal(canViewCalendar(projects, false), true);

  // owner 角色成立，但專案已封存——archived owner 不算，與 Worker 端
  // resolveCalendarScope 的 `projects.status = 'active'` 篩選一致。
  const archivedOwnerProjects: ProjectSummary[] = [{ ...projects[0], status: "archived" }];
  assert.equal(canViewCalendar(archivedOwnerProjects, false), false);

  // 只是 active 專案的 member，不是 owner——不成立。
  const memberOnlyProjects: ProjectSummary[] = [{ ...projects[0], myRole: "member" }];
  assert.equal(canViewCalendar(memberOnlyProjects, false), false);
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
    readOnlyReason: null,
  });
  assert.deepEqual(deriveBoardAccess("member", "active", "active"), {
    canEdit: true,
    canConfigureWorkflow: false,
    canWriteAttachments: true,
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
