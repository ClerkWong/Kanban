import type { ActivityLogEntry, ProjectRole, ResourceStatus } from "./types";

export type ProjectManagementActions = {
  showManagement: boolean;
  canEditProject: boolean;
};

export function projectManagementActions(
  role: ProjectRole,
  status: ResourceStatus,
): ProjectManagementActions {
  const owner = role === "owner";
  return {
    showManagement: owner,
    canEditProject: owner && status === "active",
  };
}

export function isLastOwnerChangeBlocked(
  members: Array<{ userId: string; role: ProjectRole }>,
  userId: string,
  nextRole: ProjectRole | null,
): boolean {
  const target = members.find((member) => member.userId === userId);
  if (target?.role !== "owner" || nextRole === "owner") return false;
  return members.filter((member) => member.role === "owner").length <= 1;
}

const actionLabels: Record<string, string> = {
  "project.created": "建立專案",
  "project.renamed": "重新命名專案",
  "project.archived": "封存專案",
  "project.restored": "還原專案",
  "membership.added": "新增專案成員",
  "membership.role_changed": "變更成員角色",
  "membership.removed": "移除專案成員",
  "board.created": "建立看板",
  "board.renamed": "重新命名看板",
  "board.archived": "封存看板",
  "board.restored": "還原看板",
  "board.content_updated": "更新看板內容",
  "attachment.uploaded": "上傳附件",
  "attachment.deleted": "移除附件",
};

export function activityActionLabel(action: string): string {
  return actionLabels[action] ?? action.replaceAll("_", " ").replaceAll(".", " / ");
}

export function filterActivityLogs(
  logs: ActivityLogEntry[],
  boardId: string | null,
): ActivityLogEntry[] {
  return boardId ? logs.filter((log) => log.boardId === boardId) : logs;
}

export function managementErrorMessage(error: unknown, online = true): string {
  if (!online) return "此管理操作需要網路連線；未送出，也不會加入離線同步佇列。";
  return error instanceof Error ? error.message : "管理操作失敗，請稍後再試。";
}
