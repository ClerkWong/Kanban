export type AuditEvent = {
  id: string;
  workspaceId: string;
  projectId: string;
  boardId: string | null;
  actorUserId: string;
  action: string;
  entityType: "project" | "membership" | "board" | "card" | "attachment";
  entityId: string;
  revision: number | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export async function writeAuditEvent(
  database: D1Database,
  event: AuditEvent,
): Promise<void> {
  await database.prepare(
    `INSERT INTO activity_logs (
       id, workspace_id, project_id, board_id, actor_user_id, action,
       entity_type, entity_id, revision, metadata, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id,
    event.workspaceId,
    event.projectId,
    event.boardId,
    event.actorUserId,
    event.action,
    event.entityType,
    event.entityId,
    event.revision,
    JSON.stringify(event.metadata),
    event.occurredAt,
  ).run();
}

export function prepareAuditEvent(
  database: D1Database,
  event: AuditEvent,
  onlyWhenPreviousChanged = false,
): D1PreparedStatement {
  const condition = onlyWhenPreviousChanged ? " WHERE changes() > 0" : "";
  return database.prepare(
    `INSERT INTO activity_logs (
       id, workspace_id, project_id, board_id, actor_user_id, action,
       entity_type, entity_id, revision, metadata, occurred_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${condition}`,
  ).bind(
    event.id,
    event.workspaceId,
    event.projectId,
    event.boardId,
    event.actorUserId,
    event.action,
    event.entityType,
    event.entityId,
    event.revision,
    JSON.stringify(event.metadata),
    event.occurredAt,
  );
}
