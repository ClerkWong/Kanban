PRAGMA foreign_keys = ON;

-- 0003 以唯一索引硬性限制每專案一個 active Board；產品已改為支援多看板。
DROP INDEX IF EXISTS boards_one_active_per_project_unique;

CREATE TABLE project_member_boards (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id, board_id),
  FOREIGN KEY (project_id, user_id)
    REFERENCES project_members(project_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES user_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX project_member_boards_user_idx
  ON project_member_boards(project_id, user_id);
