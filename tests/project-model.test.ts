import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_LEGACY_BOARD_ID,
  LOCAL_LEGACY_PROJECT_ID,
  canArchiveBoard,
  canArchiveProject,
  canCreateBoard,
  canDownloadAttachment,
  canEditBoard,
  canManageMembers,
  canManageProject,
  canReadProject,
  canRenameBoard,
  canRenameProject,
  canRestoreBoard,
  canRestoreProject,
  canWriteAttachment,
  isLocalPlaceholderId,
  isProjectRole,
  isResourceStatus,
  isServerResourceId,
  isUuid,
  isWorkspaceRole,
  normalizeResourceName,
  parseBoardMeta,
  parseProject,
  parseProjectList,
} from "../app/projects/model";
import type { ProjectRole } from "../app/projects/types";

const VALID_UUID_A = "5f8d6f2e-2c2b-4c9a-8b1a-8b2f3c4d5e6f";
const VALID_UUID_B = "a1b2c3d4-e5f6-4789-8abc-1234567890ab";
const VALID_UUID_C = "11111111-2222-4333-8444-555555555555";

function validProject(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_A,
    workspaceId: VALID_UUID_B,
    name: "行銷網站改版",
    status: "active",
    createdBy: VALID_UUID_C,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

function validBoardMeta(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_A,
    projectId: VALID_UUID_B,
    name: "看板 A",
    status: "active",
    revision: 3,
    createdBy: VALID_UUID_C,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

function validProjectSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_A,
    name: "行銷網站改版",
    status: "active",
    myRole: "owner",
    activeBoardCount: 1,
    boardId: VALID_UUID_B,
    boardName: "產品看板",
    lastActivityAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("role matrix: viewer has no mutation capability anywhere", () => {
  assert.equal(canReadProject("viewer"), true);
  assert.equal(canEditBoard("viewer"), false);
  assert.equal(canWriteAttachment("viewer"), false);
  assert.equal(canDownloadAttachment("viewer"), true);
  assert.equal(canCreateBoard("viewer"), false);
  assert.equal(canRenameBoard("viewer"), false);
  assert.equal(canArchiveBoard("viewer"), false);
  assert.equal(canRestoreBoard("viewer"), false);
  assert.equal(canRenameProject("viewer"), false);
  assert.equal(canManageMembers("viewer"), false);
  assert.equal(canArchiveProject("viewer"), false);
  assert.equal(canRestoreProject("viewer"), false);
  assert.equal(canManageProject("viewer"), false);
});

test("role matrix: member can edit content but has no membership/archive capability", () => {
  assert.equal(canReadProject("member"), true);
  assert.equal(canEditBoard("member"), true);
  assert.equal(canWriteAttachment("member"), true);
  assert.equal(canDownloadAttachment("member"), true);
  assert.equal(canCreateBoard("member"), false);
  assert.equal(canRenameBoard("member"), false);
  assert.equal(canArchiveBoard("member"), false);
  assert.equal(canRestoreBoard("member"), false);
  assert.equal(canRenameProject("member"), false);
  assert.equal(canManageMembers("member"), false);
  assert.equal(canArchiveProject("member"), false);
  assert.equal(canRestoreProject("member"), false);
  assert.equal(canManageProject("member"), false);
});

test("role matrix: owner can manage members, boards, and the project itself", () => {
  assert.equal(canReadProject("owner"), true);
  assert.equal(canEditBoard("owner"), true);
  assert.equal(canWriteAttachment("owner"), true);
  assert.equal(canDownloadAttachment("owner"), true);
  assert.equal(canCreateBoard("owner"), true);
  assert.equal(canRenameBoard("owner"), true);
  assert.equal(canArchiveBoard("owner"), true);
  assert.equal(canRestoreBoard("owner"), true);
  assert.equal(canRenameProject("owner"), true);
  assert.equal(canManageMembers("owner"), true);
  assert.equal(canArchiveProject("owner"), true);
  assert.equal(canRestoreProject("owner"), true);
  assert.equal(canManageProject("owner"), true);
});

test("role matrix: an unrecognized role string is denied every capability by default", () => {
  const bogus = "admin" as unknown as ProjectRole;
  assert.equal(canReadProject(bogus), false);
  assert.equal(canEditBoard(bogus), false);
  assert.equal(canManageProject(bogus), false);
  assert.equal(canDownloadAttachment(bogus), false);
});

test("workspace role never auto-grants project content permission", () => {
  // Workspace roles and project roles are disjoint string unions; an admin
  // (workspace axis) must not be treated as a manager/contributor (project
  // axis) by any capability function.
  assert.equal(isWorkspaceRole("admin"), true);
  assert.equal(isProjectRole("admin" as unknown as ProjectRole), false);
  assert.equal(canEditBoard("admin" as unknown as ProjectRole), false);
  assert.equal(canManageProject("admin" as unknown as ProjectRole), false);
});

test("isProjectRole / isWorkspaceRole / isResourceStatus narrow only known values", () => {
  assert.equal(isProjectRole("owner"), true);
  assert.equal(isProjectRole("member"), true);
  assert.equal(isProjectRole("viewer"), true);
  assert.equal(isProjectRole("manager"), false);
  assert.equal(isProjectRole(""), false);
  assert.equal(isProjectRole(undefined), false);

  assert.equal(isWorkspaceRole("owner"), true);
  assert.equal(isWorkspaceRole("admin"), true);
  assert.equal(isWorkspaceRole("member"), true);
  assert.equal(isWorkspaceRole("manager"), false);

  assert.equal(isResourceStatus("active"), true);
  assert.equal(isResourceStatus("archived"), true);
  assert.equal(isResourceStatus("deleted"), false);
});

test("normalizeResourceName trims and rejects blank names", () => {
  assert.deepEqual(normalizeResourceName("  行銷網站改版  "), {
    name: "行銷網站改版",
    key: "行銷網站改版",
  });
  assert.equal(normalizeResourceName(""), null);
  assert.equal(normalizeResourceName("   "), null);
  assert.equal(normalizeResourceName(null), null);
  assert.equal(normalizeResourceName(42), null);
});

test("normalizeResourceName rejects names longer than 80 characters after trim", () => {
  const exactly80 = "字".repeat(80);
  const over80 = "字".repeat(81);
  assert.ok(normalizeResourceName(exactly80));
  assert.equal(normalizeResourceName(over80), null);
  assert.ok(normalizeResourceName(`  ${exactly80}  `));
});

test("normalizeResourceName produces a case-folded comparison key", () => {
  const a = normalizeResourceName("Project Alpha");
  const b = normalizeResourceName("project alpha");
  assert.ok(a && b);
  assert.equal(a?.key, b?.key);
  assert.notEqual(a?.name, "project alpha");
});

test("normalizeResourceName normalizes compatibility characters in the comparison key", () => {
  const fullWidth = normalizeResourceName("Ｐｒｏｊｅｃｔ");
  const ascii = normalizeResourceName("project");
  assert.ok(fullWidth && ascii);
  assert.equal(fullWidth.key, ascii.key);
  assert.equal(fullWidth.name, "Ｐｒｏｊｅｃｔ");
});

test("isUuid accepts real UUID strings and rejects everything else", () => {
  assert.equal(isUuid(VALID_UUID_A), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(123), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(LOCAL_LEGACY_PROJECT_ID), false);
  assert.equal(isUuid(LOCAL_LEGACY_BOARD_ID), false);
});

test("isLocalPlaceholderId recognizes only the known local-only placeholders", () => {
  assert.equal(isLocalPlaceholderId(LOCAL_LEGACY_PROJECT_ID), true);
  assert.equal(isLocalPlaceholderId(LOCAL_LEGACY_BOARD_ID), true);
  assert.equal(isLocalPlaceholderId(VALID_UUID_A), false);
  assert.equal(isLocalPlaceholderId("local:legacy-something-else"), false);
});

test("isServerResourceId requires a real UUID and rejects local placeholders", () => {
  assert.equal(isServerResourceId(VALID_UUID_A), true);
  assert.equal(isServerResourceId(LOCAL_LEGACY_PROJECT_ID), false);
  assert.equal(isServerResourceId(LOCAL_LEGACY_BOARD_ID), false);
  assert.equal(isServerResourceId("not-a-uuid"), false);
});

test("parseProject accepts a well-formed record", () => {
  const parsed = parseProject(validProject());
  assert.deepEqual(parsed, {
    id: VALID_UUID_A,
    workspaceId: VALID_UUID_B,
    name: "行銷網站改版",
    status: "active",
    createdBy: VALID_UUID_C,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    archivedAt: null,
    archivedBy: null,
  });
});

test("parseProject trims the name via normalizeResourceName", () => {
  const parsed = parseProject(validProject({ name: "  行銷網站改版  " }));
  assert.equal(parsed?.name, "行銷網站改版");
});

test("parseProject rejects malformed JSON shapes", () => {
  assert.equal(parseProject(null), null);
  assert.equal(parseProject(undefined), null);
  assert.equal(parseProject("a string"), null);
  assert.equal(parseProject(42), null);
  assert.equal(parseProject([]), null);
  assert.equal(parseProject({}), null);
});

test("parseProject rejects a blank or overlong name", () => {
  assert.equal(parseProject(validProject({ name: "" })), null);
  assert.equal(parseProject(validProject({ name: "   " })), null);
  assert.equal(parseProject(validProject({ name: "字".repeat(81) })), null);
});

test("parseProject rejects non-UUID or wrong-typed id fields", () => {
  assert.equal(parseProject(validProject({ id: "not-a-uuid" })), null);
  assert.equal(parseProject(validProject({ id: LOCAL_LEGACY_PROJECT_ID })), null);
  assert.equal(parseProject(validProject({ workspaceId: 123 })), null);
  assert.equal(parseProject(validProject({ createdBy: null })), null);
});

test("parseProject rejects an invalid status and missing timestamps", () => {
  assert.equal(parseProject(validProject({ status: "deleted" })), null);
  assert.equal(parseProject(validProject({ createdAt: undefined })), null);
  assert.equal(parseProject(validProject({ updatedAt: 123 })), null);
});

test("parseProject enforces archive fields agree with status", () => {
  // active project must not carry archive metadata
  assert.equal(
    parseProject(validProject({ archivedAt: "2026-07-03T00:00:00.000Z" })),
    null,
  );
  assert.equal(parseProject(validProject({ archivedBy: VALID_UUID_C })), null);

  // archived project must carry both archivedAt and archivedBy
  assert.equal(
    parseProject(
      validProject({ status: "archived", archivedAt: null, archivedBy: null }),
    ),
    null,
  );
  assert.equal(
    parseProject(
      validProject({
        status: "archived",
        archivedAt: "2026-07-03T00:00:00.000Z",
        archivedBy: "not-a-uuid",
      }),
    ),
    null,
  );

  const archived = parseProject(
    validProject({
      status: "archived",
      archivedAt: "2026-07-03T00:00:00.000Z",
      archivedBy: VALID_UUID_C,
    }),
  );
  assert.ok(archived);
  assert.equal(archived?.status, "archived");
  assert.equal(archived?.archivedAt, "2026-07-03T00:00:00.000Z");
});

test("parseBoardMeta accepts a well-formed record", () => {
  const parsed = parseBoardMeta(validBoardMeta());
  assert.deepEqual(parsed, {
    id: VALID_UUID_A,
    projectId: VALID_UUID_B,
    name: "看板 A",
    status: "active",
    revision: 3,
    createdBy: VALID_UUID_C,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    archivedAt: null,
    archivedBy: null,
  });
});

test("parseBoardMeta rejects malformed JSON shapes and bad revision numbers", () => {
  assert.equal(parseBoardMeta(null), null);
  assert.equal(parseBoardMeta("a string"), null);
  assert.equal(parseBoardMeta([]), null);
  assert.equal(parseBoardMeta(validBoardMeta({ revision: -1 })), null);
  assert.equal(parseBoardMeta(validBoardMeta({ revision: 1.5 })), null);
  assert.equal(parseBoardMeta(validBoardMeta({ revision: "3" })), null);
  assert.equal(parseBoardMeta(validBoardMeta({ name: "" })), null);
  assert.equal(parseBoardMeta(validBoardMeta({ name: "字".repeat(81) })), null);
});

test("parseBoardMeta rejects placeholder ids and non-UUID project ids", () => {
  assert.equal(parseBoardMeta(validBoardMeta({ id: LOCAL_LEGACY_BOARD_ID })), null);
  assert.equal(
    parseBoardMeta(validBoardMeta({ projectId: LOCAL_LEGACY_PROJECT_ID })),
    null,
  );
});

test("parseBoardMeta does not accidentally accept BoardState content shape", () => {
  // BoardMeta must stay separate from board *content* -- there is no `data`
  // field, and passing one through should not change the parsed result.
  const withData = validBoardMeta({ data: { version: 4, columns: [], cards: {} } });
  const parsed = parseBoardMeta(withData);
  assert.ok(parsed);
  assert.equal((parsed as Record<string, unknown>).data, undefined);
});

test("parseProjectList returns an empty array for non-array input", () => {
  assert.deepEqual(parseProjectList(null), []);
  assert.deepEqual(parseProjectList(undefined), []);
  assert.deepEqual(parseProjectList({}), []);
  assert.deepEqual(parseProjectList("nope"), []);
});

test("parseProjectList keeps only well-formed entries and drops the rest", () => {
  const result = parseProjectList([
    validProjectSummary(),
    { bogus: true },
    validProjectSummary({ id: VALID_UUID_B, name: "另一個專案", myRole: "viewer" }),
    validProjectSummary({ myRole: "admin" }), // workspace-only role leaking in -- reject
    validProjectSummary({ activeBoardCount: -1 }),
    validProjectSummary({ name: "" }),
    null,
    42,
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], validProjectSummary());
  assert.deepEqual(
    result[1],
    validProjectSummary({ id: VALID_UUID_B, name: "另一個專案", myRole: "viewer" }),
  );
});

test("parseProjectList accepts a null lastActivityAt for a fresh project", () => {
  const result = parseProjectList([validProjectSummary({ lastActivityAt: null })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].lastActivityAt, null);
});
