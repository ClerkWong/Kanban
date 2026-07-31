PRAGMA foreign_keys = ON;

CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  token_kind TEXT NOT NULL CHECK (token_kind IN ('personal', 'legacy')),
  legacy_user_id TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (legacy_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archived_by TEXT,
  CHECK (
    (status = 'active' AND archived_at IS NULL AND archived_by IS NULL) OR
    (status = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES user_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (archived_by) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'contributor', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archived_by TEXT,
  CHECK (
    (status = 'active' AND archived_at IS NULL AND archived_by IS NULL) OR
    (status = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
  ),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES user_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (archived_by) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  board_id TEXT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('project', 'membership', 'board', 'card', 'attachment')
  ),
  entity_id TEXT NOT NULL,
  revision INTEGER CHECK (revision IS NULL OR revision >= 0),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE migration_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'locked', 'complete')),
  default_workspace_id TEXT NOT NULL,
  legacy_project_id TEXT NOT NULL,
  legacy_board_id TEXT NOT NULL,
  locked_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX workspace_members_user_idx
  ON workspace_members(user_id, workspace_id);
CREATE INDEX project_members_user_idx
  ON project_members(user_id, project_id);
CREATE INDEX projects_workspace_status_updated_idx
  ON projects(workspace_id, status, updated_at DESC);
CREATE UNIQUE INDEX projects_active_normalized_name_unique
  ON projects(workspace_id, normalized_name)
  WHERE status = 'active';
CREATE INDEX boards_project_status_updated_idx
  ON boards(project_id, status, updated_at DESC);
CREATE UNIQUE INDEX boards_active_normalized_name_unique
  ON boards(project_id, normalized_name)
  WHERE status = 'active';
CREATE INDEX activity_logs_project_page_idx
  ON activity_logs(project_id, occurred_at DESC, id DESC);
CREATE INDEX activity_logs_board_page_idx
  ON activity_logs(board_id, occurred_at DESC, id DESC);

CREATE TRIGGER activity_logs_no_update
BEFORE UPDATE ON activity_logs
BEGIN
  SELECT RAISE(ABORT, 'activity_logs are append-only');
END;

CREATE TRIGGER activity_logs_no_delete
BEFORE DELETE ON activity_logs
BEGIN
  SELECT RAISE(ABORT, 'activity_logs are append-only');
END;

INSERT INTO migration_state (
  id,
  status,
  default_workspace_id,
  legacy_project_id,
  legacy_board_id,
  locked_at,
  completed_at,
  updated_at,
  error
) VALUES (
  1,
  'pending',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
);
