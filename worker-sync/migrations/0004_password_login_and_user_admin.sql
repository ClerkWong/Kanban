PRAGMA foreign_keys = ON;

ALTER TABLE user_accounts ADD COLUMN email TEXT;
ALTER TABLE user_accounts ADD COLUMN normalized_email TEXT;

CREATE UNIQUE INDEX user_accounts_normalized_email_unique
  ON user_accounts(normalized_email)
  WHERE normalized_email IS NOT NULL;

CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK (algorithm = 'PBKDF2-SHA512'),
  iterations INTEGER NOT NULL CHECK (iterations >= 100000),
  salt TEXT NOT NULL CHECK (length(salt) BETWEEN 20 AND 64),
  password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 80 AND 128),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE INDEX user_sessions_user_active_idx
  ON user_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE login_attempts (
  attempt_key TEXT PRIMARY KEY CHECK (
    length(attempt_key) = 64 AND attempt_key NOT GLOB '*[^0-9a-f]*'
  ),
  failed_count INTEGER NOT NULL CHECK (failed_count >= 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspace_activity_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_user_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES user_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX workspace_activity_logs_page_idx
  ON workspace_activity_logs(workspace_id, occurred_at DESC, id DESC);

CREATE TRIGGER workspace_activity_logs_no_update
BEFORE UPDATE ON workspace_activity_logs
BEGIN
  SELECT RAISE(ABORT, 'workspace_activity_logs are append-only');
END;

CREATE TRIGGER workspace_activity_logs_no_delete
BEFORE DELETE ON workspace_activity_logs
BEGIN
  SELECT RAISE(ABORT, 'workspace_activity_logs are append-only');
END;
