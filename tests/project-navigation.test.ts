import assert from "node:assert/strict";
import test from "node:test";

import {
  boardBelongsToRoute,
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
    canWriteAttachments: true,
    readOnlyReason: null,
  });
  assert.deepEqual(deriveBoardAccess("member", "active", "active"), {
    canEdit: true,
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
