import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildBootstrapSql,
  buildWranglerArgs,
  hashToken,
  parseBootstrapArgs,
} from "../scripts/bootstrap-sync-workspace";
import {
  DEFAULT_WORKSPACE_ID,
  LEGACY_BOARD_ID,
  LEGACY_PROJECT_ID,
  LEGACY_SHARED_USER_ID,
} from "../worker-sync/src/db-types";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TOKEN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "unit-test-personal-token-32-characters-minimum";
const TOKEN_HASH = hashToken(TOKEN);
const migration1 = readFileSync(
  new URL("../worker-sync/migrations/0001_init.sql", import.meta.url),
  "utf8",
);
const migration2 = readFileSync(
  new URL("../worker-sync/migrations/0002_multi_project.sql", import.meta.url),
  "utf8",
);
const migration3 = readFileSync(
  new URL("../worker-sync/migrations/0003_single_board_projects.sql", import.meta.url),
  "utf8",
);

function createLegacyDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(migration1);
  return database;
}

function bootstrapSql() {
  return buildBootstrapSql({
    target: "local",
    userId: USER_ID,
    displayName: "測試 Owner",
    workspaceName: "測試 Workspace",
    tokenLabel: "測試裝置",
    confirmProduction: false,
    tokenId: TOKEN_ID,
    tokenHash: TOKEN_HASH,
  });
}

test("parseBootstrapArgs requires an explicit target and stable owner UUID", () => {
  assert.deepEqual(
    parseBootstrapArgs([
      "--target",
      "local",
      "--user-id",
      USER_ID,
      "--display-name",
      "  測試 Owner  ",
    ]),
    {
      target: "local",
      userId: USER_ID,
      displayName: "測試 Owner",
      workspaceName: "Kanban Workspace",
      tokenLabel: "bootstrap",
      confirmProduction: false,
    },
  );

  assert.throws(() => parseBootstrapArgs([]), /--target/);
  assert.throws(
    () =>
      parseBootstrapArgs([
        "--target",
        "local",
        "--user-id",
        "not-a-uuid",
        "--display-name",
        "Owner",
      ]),
    /UUID/,
  );
});

test("parseBootstrapArgs rejects command-line tokens and unconfirmed production", () => {
  assert.throws(
    () =>
      parseBootstrapArgs([
        "--target",
        "local",
        "--user-id",
        USER_ID,
        "--display-name",
        "Owner",
        "--token",
        "must-not-appear",
      ]),
    /不可使用命令列/,
  );
  assert.throws(
    () =>
      parseBootstrapArgs([
        "--target",
        "production",
        "--user-id",
        USER_ID,
        "--display-name",
        "Owner",
      ]),
    /confirm-production/,
  );
});

test("buildWranglerArgs keeps targets explicit and never includes token material", () => {
  const local = buildWranglerArgs("local", "/tmp/bootstrap.sql");
  assert.ok(local.includes("--local"));
  assert.ok(!local.includes("--remote"));
  assert.ok(!local.join(" ").includes(TOKEN));

  const staging = buildWranglerArgs("staging", "/tmp/bootstrap.sql");
  assert.ok(staging.includes("--remote"));
  assert.deepEqual(staging.slice(-2), ["--env", "staging"]);
});

test("0002 is additive, preserves legacy rows, and starts migration pending", () => {
  const database = createLegacyDatabase();
  database
    .prepare("INSERT INTO users (id, name, token_hash) VALUES (?, ?, ?)")
    .run("legacy-user", "Legacy", "a".repeat(64));
  database
    .prepare("INSERT INTO board (id, revision, data, updated_at) VALUES (1, 7, '{}', ?)")
    .run("2026-07-26T00:00:00.000Z");

  database.exec(migration2);

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get()!.count, 1);
  assert.equal(database.prepare("SELECT revision FROM board WHERE id = 1").get()!.revision, 7);
  assert.deepEqual(
    {
      ...database
      .prepare(
        "SELECT status, default_workspace_id, legacy_project_id, legacy_board_id FROM migration_state WHERE id = 1",
      )
      .get(),
    },
    {
      status: "pending",
      default_workspace_id: DEFAULT_WORKSPACE_ID,
      legacy_project_id: LEGACY_PROJECT_ID,
      legacy_board_id: LEGACY_BOARD_ID,
    },
  );
  database.close();
});

test("fresh bootstrap creates the owner and personal token, then marks migration complete", () => {
  const database = createLegacyDatabase();
  database.exec(migration2);
  database.exec(bootstrapSql());

  assert.deepEqual(
    {
      ...database
      .prepare("SELECT id, name FROM workspaces WHERE id = ?")
      .get(DEFAULT_WORKSPACE_ID),
    },
    { id: DEFAULT_WORKSPACE_ID, name: "測試 Workspace" },
  );
  assert.deepEqual(
    {
      ...database
      .prepare("SELECT user_id, role FROM workspace_members WHERE workspace_id = ?")
      .get(DEFAULT_WORKSPACE_ID),
    },
    { user_id: USER_ID, role: "owner" },
  );
  assert.deepEqual(
    {
      ...database
      .prepare("SELECT user_id, token_kind, token_hash FROM access_tokens WHERE id = ?")
      .get(TOKEN_ID),
    },
    { user_id: USER_ID, token_kind: "personal", token_hash: TOKEN_HASH },
  );
  assert.equal(
    database.prepare("SELECT status FROM migration_state WHERE id = 1").get()!.status,
    "complete",
  );
  assert.ok(!bootstrapSql().includes(TOKEN));
  database.close();
});

test("legacy bootstrap stays pending, marks copied tokens legacy, and maps the manager idempotently", () => {
  const database = createLegacyDatabase();
  const legacyHash = "b".repeat(64);
  database
    .prepare("INSERT INTO users (id, name, token_hash) VALUES (?, ?, ?)")
    .run("shared-client", "Shared client", legacyHash);
  database
    .prepare("INSERT INTO board (id, revision, data, updated_at) VALUES (1, 9, '{}', ?)")
    .run("2026-07-26T00:00:00.000Z");
  database.exec(migration2);
  database.exec(bootstrapSql());

  assert.equal(
    database.prepare("SELECT status FROM migration_state WHERE id = 1").get()!.status,
    "pending",
  );
  assert.deepEqual(
    {
      ...database
      .prepare(
        "SELECT user_id, token_kind, legacy_user_id FROM access_tokens WHERE token_hash = ?",
      )
      .get(legacyHash),
    },
    {
      user_id: LEGACY_SHARED_USER_ID,
      token_kind: "legacy",
      legacy_user_id: "shared-client",
    },
  );

  database
    .prepare(
      `INSERT INTO projects (
        id, workspace_id, name, normalized_name, status, created_by,
        created_at, updated_at, archived_at, archived_by
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL)`,
    )
    .run(
      LEGACY_PROJECT_ID,
      DEFAULT_WORKSPACE_ID,
      "Legacy Project",
      "legacy project",
      USER_ID,
      "2026-07-26T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
    );

  database.exec(bootstrapSql());
  database.exec(bootstrapSql());
  assert.deepEqual(
    {
      ...database
      .prepare("SELECT user_id, role FROM project_members WHERE project_id = ?")
      .get(LEGACY_PROJECT_ID),
    },
    { user_id: USER_ID, role: "manager" },
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM access_tokens").get()!.count,
    2,
  );
  database.close();
});

test("active normalized Project and Board names are unique only within their parent", () => {
  const database = createLegacyDatabase();
  database.exec(migration2);
  database.exec(bootstrapSql());
  const timestamp = "2026-07-26T00:00:00.000Z";

  const insertProject = database.prepare(
    `INSERT INTO projects (
      id, workspace_id, name, normalized_name, status, created_by,
      created_at, updated_at, archived_at, archived_by
    ) VALUES (?, ?, ?, 'same', ?, ?, ?, ?, ?, ?)`,
  );
  insertProject.run(
    LEGACY_PROJECT_ID,
    DEFAULT_WORKSPACE_ID,
    "First",
    "active",
    USER_ID,
    timestamp,
    timestamp,
    null,
    null,
  );
  assert.throws(() =>
    insertProject.run(
      "22222222-3333-4444-8555-666666666666",
      DEFAULT_WORKSPACE_ID,
      "Second",
      "active",
      USER_ID,
      timestamp,
      timestamp,
      null,
      null,
    ),
  );
  assert.doesNotThrow(() =>
    insertProject.run(
      "33333333-4444-4555-8666-777777777777",
      DEFAULT_WORKSPACE_ID,
      "Archived duplicate",
      "archived",
      USER_ID,
      timestamp,
      timestamp,
      timestamp,
      USER_ID,
    ),
  );

  database
    .prepare(
      `INSERT INTO project_members (
        project_id, user_id, role, created_at, updated_at
      ) VALUES (?, ?, 'manager', ?, ?)`,
    )
    .run(LEGACY_PROJECT_ID, USER_ID, timestamp, timestamp);
  const insertBoard = database.prepare(
    `INSERT INTO boards (
      id, project_id, name, normalized_name, status, revision, data,
      created_by, created_at, updated_at, archived_at, archived_by
    ) VALUES (?, ?, ?, 'same board', ?, 0, '{}', ?, ?, ?, ?, ?)`,
  );
  insertBoard.run(
    LEGACY_BOARD_ID,
    LEGACY_PROJECT_ID,
    "Board A",
    "active",
    USER_ID,
    timestamp,
    timestamp,
    null,
    null,
  );
  assert.throws(() =>
    insertBoard.run(
      "44444444-5555-4666-8777-888888888888",
      LEGACY_PROJECT_ID,
      "Board B",
      "active",
      USER_ID,
      timestamp,
      timestamp,
      null,
      null,
    ),
  );
  assert.doesNotThrow(() =>
    insertBoard.run(
      "55555555-6666-4777-8888-999999999999",
      LEGACY_PROJECT_ID,
      "Archived Board",
      "archived",
      USER_ID,
      timestamp,
      timestamp,
      timestamp,
      USER_ID,
    ),
  );
  database.close();
});

test("0003 preserves one active Board and archives extra Boards as history", () => {
  const database = createLegacyDatabase();
  database.exec(migration2);
  database.exec(bootstrapSql());
  const timestamp = "2026-07-26T00:00:00.000Z";
  database.prepare(
    `INSERT INTO projects (
      id, workspace_id, name, normalized_name, status, created_by,
      created_at, updated_at, archived_at, archived_by
    ) VALUES (?, ?, 'Single Board Project', 'single board project', 'active', ?, ?, ?, NULL, NULL)`,
  ).run(LEGACY_PROJECT_ID, DEFAULT_WORKSPACE_ID, USER_ID, timestamp, timestamp);
  const insertBoard = database.prepare(
    `INSERT INTO boards (
      id, project_id, name, normalized_name, status, revision, data,
      created_by, created_at, updated_at, archived_at, archived_by
    ) VALUES (?, ?, ?, ?, 'active', 0, '{}', ?, ?, ?, NULL, NULL)`,
  );
  insertBoard.run(
    LEGACY_BOARD_ID,
    LEGACY_PROJECT_ID,
    "Older",
    "older",
    USER_ID,
    timestamp,
    "2026-07-26T01:00:00.000Z",
  );
  const preferredId = "55555555-6666-4777-8888-999999999999";
  insertBoard.run(
    preferredId,
    LEGACY_PROJECT_ID,
    "Preferred",
    "preferred",
    USER_ID,
    timestamp,
    "2026-07-26T02:00:00.000Z",
  );

  database.exec(migration3);

  assert.deepEqual(
    database.prepare("SELECT id, status FROM boards ORDER BY id").all().map((row) => ({ ...row })),
    [
      { id: LEGACY_BOARD_ID, status: "archived" },
      { id: preferredId, status: "active" },
    ],
  );
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) AS count FROM activity_logs WHERE action = 'board.archived_for_single_board'",
    ).get()!.count,
    1,
  );
  assert.throws(() =>
    insertBoard.run(
      "66666666-7777-4888-8999-000000000000",
      LEGACY_PROJECT_ID,
      "Another",
      "another",
      USER_ID,
      timestamp,
      "2026-07-26T03:00:00.000Z",
    ),
  );
  database.close();
});

test("activity logs are append-only at the database layer", () => {
  const database = createLegacyDatabase();
  database.exec(migration2);
  database.exec(bootstrapSql());
  const timestamp = "2026-07-26T00:00:00.000Z";
  database
    .prepare(
      `INSERT INTO projects (
        id, workspace_id, name, normalized_name, status, created_by,
        created_at, updated_at, archived_at, archived_by
      ) VALUES (?, ?, 'Project', 'project', 'active', ?, ?, ?, NULL, NULL)`,
    )
    .run(LEGACY_PROJECT_ID, DEFAULT_WORKSPACE_ID, USER_ID, timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO activity_logs (
        id, workspace_id, project_id, board_id, actor_user_id, action,
        entity_type, entity_id, revision, metadata, occurred_at
      ) VALUES (?, ?, ?, NULL, ?, 'project.created', 'project', ?, NULL, '{}', ?)`,
    )
    .run(
      "66666666-7777-4888-8999-aaaaaaaaaaaa",
      DEFAULT_WORKSPACE_ID,
      LEGACY_PROJECT_ID,
      USER_ID,
      LEGACY_PROJECT_ID,
      timestamp,
    );

  assert.throws(() =>
    database
      .prepare("UPDATE activity_logs SET action = 'changed' WHERE project_id = ?")
      .run(LEGACY_PROJECT_ID),
  );
  assert.throws(() =>
    database.prepare("DELETE FROM activity_logs WHERE project_id = ?").run(LEGACY_PROJECT_ID),
  );
  database.close();
});
