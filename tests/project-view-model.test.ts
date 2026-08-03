import assert from "node:assert/strict";
import test from "node:test";
import {
  activityActionLabel,
  filterActivityLogs,
  isLastOwnerChangeBlocked,
  managementErrorMessage,
  projectManagementActions,
} from "../app/projects/view-model";
import type { ActivityLogEntry } from "../app/projects/types";

test("only an active Project owner sees management actions", () => {
  assert.deepEqual(projectManagementActions("owner", "active"), {
    showManagement: true,
    canEditProject: true,
  });
  assert.equal(projectManagementActions("owner", "archived").canEditProject, false);
  assert.equal(projectManagementActions("member", "active").showManagement, false);
  assert.equal(projectManagementActions("viewer", "active").showManagement, false);
});

test("last owner guard blocks removal and downgrade until another owner exists", () => {
  const one = [{ userId: "one", role: "owner" as const }];
  assert.equal(isLastOwnerChangeBlocked(one, "one", null), true);
  assert.equal(isLastOwnerChangeBlocked(one, "one", "member"), true);
  assert.equal(isLastOwnerChangeBlocked(one, "one", "owner"), false);
  assert.equal(isLastOwnerChangeBlocked([...one, { userId: "two", role: "owner" }], "one", null), false);
});

test("activity view model labels known actions, filters boards, and explains offline mutations", () => {
  const base = {
    workspaceId: "a0000000-0000-4000-8000-000000000001",
    projectId: "a0000000-0000-4000-8000-000000000002",
    actorUserId: "a0000000-0000-4000-8000-000000000003",
    action: "board.archived",
    entityType: "board" as const,
    entityId: "a0000000-0000-4000-8000-000000000004",
    revision: null,
    metadata: {},
    occurredAt: "2026-07-27T00:00:00.000Z",
  };
  const logs: ActivityLogEntry[] = [
    { ...base, id: "a0000000-0000-4000-8000-000000000005", boardId: "a0000000-0000-4000-8000-000000000006" },
    { ...base, id: "a0000000-0000-4000-8000-000000000007", boardId: null },
  ];
  assert.equal(activityActionLabel("board.archived"), "封存看板");
  assert.equal(filterActivityLogs(logs, logs[0].boardId).length, 1);
  assert.match(managementErrorMessage(new Error("x"), false), /需要網路連線/);
});
