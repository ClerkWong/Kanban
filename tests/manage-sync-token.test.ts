import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildCreateTokenSql,
  buildListTokensSql,
  buildRevokeTokenSql,
  buildTokenWranglerArgs,
  parseTokenCommand,
} from "../scripts/manage-sync-token";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TOKEN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const migration1 = readFileSync(
  new URL("../worker-sync/migrations/0001_init.sql", import.meta.url),
  "utf8",
);
const migration2 = readFileSync(
  new URL("../worker-sync/migrations/0002_multi_project.sql", import.meta.url),
  "utf8",
);

test("token CLI rejects command-line secrets and unconfirmed production", () => {
  assert.throws(
    () => parseTokenCommand([
      "create", "--target", "staging", "--user-id", USER_ID,
      "--label", "Web", "--token", "secret",
    ]),
    /Token 不可使用命令列參數/,
  );
  assert.throws(
    () => parseTokenCommand([
      "list", "--target", "production", "--user-id", USER_ID,
    ]),
    /--confirm-production/,
  );
});

test("token create SQL requires an active user and stores only the supplied hash", () => {
  const hash = "a".repeat(64);
  const sql = buildCreateTokenSql({
    userId: USER_ID,
    tokenId: TOKEN_ID,
    label: "iPhone",
    tokenHash: hash,
  });
  assert.match(sql, /status = 'active'/);
  assert.match(sql, /token_kind/);
  assert.match(sql, /'personal'/);
  assert.match(sql, new RegExp(hash));
  assert.doesNotMatch(sql, /Authorization|Bearer/);
});

test("token revoke is scoped to one active personal token", () => {
  const sql = buildRevokeTokenSql(USER_ID, TOKEN_ID);
  assert.match(sql, new RegExp(`id = '${TOKEN_ID}'`));
  assert.match(sql, new RegExp(`user_id = '${USER_ID}'`));
  assert.match(sql, /token_kind = 'personal'/);
  assert.match(sql, /revoked_at IS NULL/);
  assert.match(sql, /VALUES \(changes\(\)\)/);
});

test("create and revoke SQL execute atomically against the migrated schema", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(migration1);
  database.exec(migration2);
  database.prepare(
    `INSERT INTO user_accounts (id, display_name, status, created_at, updated_at)
     VALUES (?, 'Alice', 'active', ?, ?)`,
  ).run(USER_ID, "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");

  database.exec(buildCreateTokenSql({
    userId: USER_ID,
    tokenId: TOKEN_ID,
    label: "Alice Web",
    tokenHash: "a".repeat(64),
  }));
  assert.deepEqual(
    {
      ...database.prepare(
        "SELECT id, user_id, label, token_kind, revoked_at FROM access_tokens WHERE id = ?",
      ).get(TOKEN_ID),
    },
    {
      id: TOKEN_ID,
      user_id: USER_ID,
      label: "Alice Web",
      token_kind: "personal",
      revoked_at: null,
    },
  );

  database.exec(buildRevokeTokenSql(USER_ID, TOKEN_ID));
  assert.equal(
    database.prepare("SELECT revoked_at IS NOT NULL AS revoked FROM access_tokens WHERE id = ?")
      .get(TOKEN_ID)!.revoked,
    1,
  );
  assert.throws(() => database.exec(buildRevokeTokenSql(USER_ID, TOKEN_ID)));
  database.close();
});

test("token listing never selects token hashes", () => {
  const sql = buildListTokensSql(USER_ID);
  assert.doesNotMatch(sql, /token_hash/);
  assert.match(sql, /last_used_at/);
  assert.match(sql, /revoked_at/);
});

test("staging token commands are pinned to the staging D1 environment", () => {
  assert.deepEqual(buildTokenWranglerArgs("staging", "/tmp/token.sql"), [
    "exec", "wrangler", "d1", "execute", "kanban-sync-staging", "--remote",
    "--file", "/tmp/token.sql", "-c", "worker-sync/wrangler.jsonc",
    "--env", "staging",
  ]);
});
