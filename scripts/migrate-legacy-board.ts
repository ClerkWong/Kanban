import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  DEFAULT_WORKSPACE_ID,
  LEGACY_BOARD_ID,
  LEGACY_PROJECT_ID,
  LEGACY_SHARED_USER_ID,
} from "../worker-sync/src/db-types";
import type { BootstrapTarget } from "./bootstrap-sync-workspace";

export function buildLegacyLockSql(): string {
  return `UPDATE migration_state SET status = 'locked', locked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), error = NULL WHERE id = 1 AND status = 'pending';`;
}

export function buildLegacyCopySql(managerUserId: string): string {
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  return `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
INSERT INTO projects (id, workspace_id, name, normalized_name, status, created_by, created_at, updated_at, archived_at, archived_by)
SELECT ${q(LEGACY_PROJECT_ID)}, ${q(DEFAULT_WORKSPACE_ID)}, 'Legacy Project', 'legacy project', 'active', ${q(managerUserId)}, ${now}, ${now}, NULL, NULL
WHERE EXISTS (SELECT 1 FROM board WHERE id = 1)
ON CONFLICT(id) DO NOTHING;
INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
VALUES (${q(LEGACY_PROJECT_ID)}, ${q(managerUserId)}, 'manager', ${now}, ${now})
ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'manager', updated_at = excluded.updated_at;
INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
SELECT ${q(LEGACY_PROJECT_ID)}, ${q(LEGACY_SHARED_USER_ID)}, 'contributor', ${now}, ${now}
WHERE EXISTS (SELECT 1 FROM user_accounts WHERE id = ${q(LEGACY_SHARED_USER_ID)})
ON CONFLICT(project_id, user_id) DO NOTHING;
INSERT INTO boards (id, project_id, name, normalized_name, status, revision, data, created_by, created_at, updated_at, archived_at, archived_by)
SELECT ${q(LEGACY_BOARD_ID)}, ${q(LEGACY_PROJECT_ID)}, 'Legacy Board', 'legacy board', 'active', revision, data, ${q(managerUserId)}, ${now}, updated_at, NULL, NULL
FROM board WHERE id = 1
ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, data = excluded.data, updated_at = excluded.updated_at;
UPDATE migration_state
SET status = 'complete', completed_at = ${now}, updated_at = ${now}, error = NULL
WHERE id = 1 AND status = 'locked' AND EXISTS (SELECT 1 FROM boards WHERE id = ${q(LEGACY_BOARD_ID)});
COMMIT;`.trim();
}

export function buildLegacyFailureSql(message = "migration command failed"): string {
  return `UPDATE migration_state SET status = 'pending', locked_at = NULL, completed_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), error = '${message.replaceAll("'", "''")}' WHERE id = 1 AND status = 'locked';`;
}

function parseArgs(args: string[]): { target: BootstrapTarget; managerUserId: string } {
  const target = args[args.indexOf("--target") + 1] as BootstrapTarget;
  const managerUserId = args[args.indexOf("--manager-user-id") + 1] ?? "";
  if (!["local", "staging", "production"].includes(target)) throw new Error("--target 必須是 local、staging 或 production。");
  if (target === "production" && !args.includes("--confirm-production")) throw new Error("Production migration 需要 --confirm-production。");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(managerUserId)) {
    throw new Error("--manager-user-id 必須是 UUID。");
  }
  return { target, managerUserId };
}

async function execute(target: BootstrapTarget, sql: string): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-legacy-migration-"));
  const file = path.join(directory, "migration.sql");
  await writeFile(file, sql, { mode: 0o600 });
  const database = target === "staging" ? "kanban-sync-staging" : "kanban-sync";
  const args = ["exec", "wrangler", "d1", "execute", database, target === "local" ? "--local" : "--remote", "--file", file, "-c", "worker-sync/wrangler.jsonc"];
  if (target === "staging") args.push("--env", "staging");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("pnpm", args, { stdio: "inherit", env: { ...process.env, WRANGLER_LOG_PATH: path.resolve(".wrangler/wrangler.log") } });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Wrangler exit ${code}`)));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { target, managerUserId } = parseArgs(args);
  await execute(target, buildLegacyLockSql());
  try {
    await execute(target, buildLegacyCopySql(managerUserId));
  } catch (error) {
    await execute(target, buildLegacyFailureSql(error instanceof Error ? error.message : "migration failed"));
    throw error;
  }
  process.stdout.write(`Legacy Board migration complete (${target}); token values were not read or printed.\n`);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Legacy migration failed."}\n`);
    process.exitCode = 1;
  });
}
