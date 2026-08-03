PRAGMA foreign_keys = ON;

-- Keep the most recently updated active Board as the Project's primary Board.
-- Historical extras are preserved read-only and remain available to Logs.
INSERT INTO activity_logs (
  id, workspace_id, project_id, board_id, actor_user_id, action,
  entity_type, entity_id, revision, metadata, occurred_at
)
SELECT
  'migration-0003-' || boards.id,
  projects.workspace_id,
  boards.project_id,
  boards.id,
  boards.created_by,
  'board.archived_for_single_board',
  'board',
  boards.id,
  boards.revision,
  json_object('reason', 'single_board_project_migration'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM boards
INNER JOIN projects ON projects.id = boards.project_id
WHERE boards.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM boards AS preferred
    WHERE preferred.project_id = boards.project_id
      AND preferred.status = 'active'
      AND (
        preferred.updated_at > boards.updated_at OR
        (preferred.updated_at = boards.updated_at AND preferred.id > boards.id)
      )
  );

UPDATE boards
SET status = 'archived',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    archived_by = created_by
WHERE status = 'active'
  AND EXISTS (
    SELECT 1
    FROM boards AS preferred
    WHERE preferred.project_id = boards.project_id
      AND preferred.status = 'active'
      AND (
        preferred.updated_at > boards.updated_at OR
        (preferred.updated_at = boards.updated_at AND preferred.id > boards.id)
      )
  );

CREATE UNIQUE INDEX boards_one_active_per_project_unique
  ON boards(project_id)
  WHERE status = 'active';
