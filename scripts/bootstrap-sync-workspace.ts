import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import {
  DEFAULT_WORKSPACE_ID,
  LEGACY_PROJECT_ID,
  LEGACY_SHARED_USER_ID,
} from "../worker-sync/src/db-types";

export type BootstrapTarget = "local" | "staging" | "production";

export type BootstrapOptions = {
  target: BootstrapTarget;
  userId: string;
  displayName: string;
  workspaceName: string;
  tokenLabel: string;
  confirmProduction: boolean;
};

export type BootstrapSqlInput = BootstrapOptions & {
  tokenId: string;
  tokenHash: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeName(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error(`${field} 必須是 1–80 個字元。`);
  }
  return normalized;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} 缺少值。`);
  }
  return value;
}

export function parseBootstrapArgs(args: string[]): BootstrapOptions {
  const values = new Map<string, string>();
  let confirmProduction = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-production") {
      confirmProduction = true;
      continue;
    }
    if (arg === "--token" || arg.startsWith("--token=")) {
      throw new Error("Token 不可使用命令列參數傳入；請使用互動提示或 stdin。");
    }
    if (
      arg !== "--target" &&
      arg !== "--user-id" &&
      arg !== "--display-name" &&
      arg !== "--workspace-name" &&
      arg !== "--token-label"
    ) {
      throw new Error(`不支援的參數：${arg}`);
    }
    const value = requireValue(args, index, arg);
    if (values.has(arg)) {
      throw new Error(`${arg} 不可重複。`);
    }
    values.set(arg, value);
    index += 1;
  }

  const target = values.get("--target");
  if (target !== "local" && target !== "staging" && target !== "production") {
    throw new Error("--target 必須明確指定 local、staging 或 production。");
  }
  if (target === "production" && !confirmProduction) {
    throw new Error("Production bootstrap 必須加上 --confirm-production 明確確認。");
  }

  const userId = values.get("--user-id") ?? "";
  if (!UUID_PATTERN.test(userId)) {
    throw new Error("--user-id 必須是 UUID；重跑時請使用同一個 ID。");
  }

  return {
    target,
    userId,
    displayName: normalizeName(values.get("--display-name") ?? "", "--display-name"),
    workspaceName: normalizeName(
      values.get("--workspace-name") ?? "Kanban Workspace",
      "--workspace-name",
    ),
    tokenLabel: normalizeName(values.get("--token-label") ?? "bootstrap", "--token-label"),
    confirmProduction,
  };
}

export function validateToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length < 32 || normalized.length > 4096 || /\s/.test(normalized)) {
    throw new Error("Token 必須是 32–4096 個不含空白的字元。");
  }
  return normalized;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(validateToken(token)).digest("hex");
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildBootstrapSql(input: BootstrapSqlInput): string {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const userId = quote(input.userId);
  const displayName = quote(input.displayName);
  const workspaceName = quote(input.workspaceName);
  const tokenId = quote(input.tokenId);
  const tokenLabel = quote(input.tokenLabel);
  const tokenHash = quote(input.tokenHash);
  const workspaceId = quote(DEFAULT_WORKSPACE_ID);
  const legacyUserId = quote(LEGACY_SHARED_USER_ID);
  const legacyProjectId = quote(LEGACY_PROJECT_ID);

  return `
PRAGMA foreign_keys = ON;

INSERT INTO workspaces (id, name, created_at, updated_at)
VALUES (${workspaceId}, ${workspaceName}, ${now}, ${now})
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  updated_at = excluded.updated_at;

INSERT INTO user_accounts (id, display_name, status, created_at, updated_at)
VALUES (${userId}, ${displayName}, 'active', ${now}, ${now})
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
VALUES (${workspaceId}, ${userId}, 'owner', ${now}, ${now})
ON CONFLICT(workspace_id, user_id) DO UPDATE SET
  role = 'owner',
  updated_at = excluded.updated_at;

INSERT INTO user_accounts (id, display_name, status, created_at, updated_at)
SELECT ${legacyUserId}, 'Legacy shared access', 'active', ${now}, ${now}
WHERE EXISTS (SELECT 1 FROM users)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  updated_at = excluded.updated_at;

INSERT INTO access_tokens (
  id, user_id, label, token_hash, token_kind, legacy_user_id,
  created_at, last_used_at, revoked_at
)
SELECT
  lower(
    substr(token_hash, 1, 8) || '-' ||
    substr(token_hash, 9, 4) || '-' ||
    '5' || substr(token_hash, 14, 3) || '-' ||
    '8' || substr(token_hash, 18, 3) || '-' ||
    substr(token_hash, 21, 12)
  ),
  ${legacyUserId},
  'Legacy token (' || substr(id, 1, 48) || ')',
  token_hash,
  'legacy',
  id,
  ${now},
  NULL,
  NULL
FROM users
WHERE 1 = 1
ON CONFLICT(token_hash) DO UPDATE SET
  user_id = excluded.user_id,
  label = excluded.label,
  token_kind = 'legacy',
  legacy_user_id = excluded.legacy_user_id;

INSERT INTO access_tokens (
  id, user_id, label, token_hash, token_kind, legacy_user_id,
  created_at, last_used_at, revoked_at
)
VALUES (
  ${tokenId}, ${userId}, ${tokenLabel}, ${tokenHash}, 'personal', NULL,
  ${now}, NULL, NULL
)
ON CONFLICT(token_hash) DO UPDATE SET
  user_id = excluded.user_id,
  label = excluded.label,
  token_kind = 'personal',
  legacy_user_id = NULL,
  revoked_at = NULL;

INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
SELECT ${legacyProjectId}, ${userId}, 'manager', ${now}, ${now}
WHERE EXISTS (SELECT 1 FROM projects WHERE id = ${legacyProjectId})
ON CONFLICT(project_id, user_id) DO UPDATE SET
  role = 'manager',
  updated_at = excluded.updated_at;

UPDATE migration_state
SET
  status = CASE
    WHEN status = 'locked' THEN 'locked'
    WHEN status = 'complete' THEN 'complete'
    WHEN NOT EXISTS (SELECT 1 FROM board) THEN 'complete'
    ELSE 'pending'
  END,
  completed_at = CASE
    WHEN status = 'locked' THEN completed_at
    WHEN status = 'complete' THEN completed_at
    WHEN NOT EXISTS (SELECT 1 FROM board) THEN ${now}
    ELSE NULL
  END,
  updated_at = ${now},
  error = NULL
WHERE id = 1;
`.trimStart();
}

export function buildWranglerArgs(target: BootstrapTarget, sqlPath: string): string[] {
  const database = target === "staging" ? "kanban-sync-staging" : "kanban-sync";
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    database,
    target === "local" ? "--local" : "--remote",
    "--file",
    sqlPath,
    "-c",
    "worker-sync/wrangler.jsonc",
  ];
  if (target === "staging") {
    args.push("--env", "staging");
  }
  return args;
}

async function readPipedToken(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) {
      throw new Error("Token 輸入超過 4096 bytes。");
    }
    chunks.push(buffer);
  }
  return validateToken(Buffer.concat(chunks).toString("utf8"));
}

async function readInteractiveToken(): Promise<string> {
  process.stderr.write("請輸入個人 access token（輸入內容不會顯示）：");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) {
        reject(error);
      } else {
        try {
          resolve(validateToken(value));
        } catch (validationError) {
          reject(validationError);
        }
      }
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish(new Error("已取消 bootstrap。"));
          return;
        }
        if (byte === 13 || byte === 10) {
          finish();
          return;
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
        } else if (byte >= 32 && byte <= 126 && value.length < 4096) {
          value += String.fromCharCode(byte);
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readToken(): Promise<string> {
  return process.stdin.isTTY ? readInteractiveToken() : readPipedToken();
}

async function runWrangler(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: path.resolve(".wrangler/wrangler.log"),
      },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            signal
              ? `Wrangler 被 signal ${signal} 中止。`
              : `Wrangler 執行失敗（exit ${code ?? "unknown"}）。`,
          ),
        );
      }
    });
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseBootstrapArgs(args);
  const token = await readToken();
  const sql = buildBootstrapSql({
    ...options,
    tokenId: randomUUID(),
    tokenHash: hashToken(token),
  });

  const tempDirectory = await mkdtemp(path.join(tmpdir(), "kanban-bootstrap-"));
  const sqlPath = path.join(tempDirectory, "bootstrap.sql");
  try {
    await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
    await runWrangler(buildWranglerArgs(options.target, sqlPath));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }

  process.stdout.write(
    [
      "Workspace bootstrap 完成。",
      `target=${options.target}`,
      `workspaceId=${DEFAULT_WORKSPACE_ID}`,
      `userId=${options.userId}`,
      `legacyProjectId=${LEGACY_PROJECT_ID}`,
      "token=未顯示",
    ].join("\n") + "\n",
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Workspace bootstrap 發生未知錯誤。"}\n`,
    );
    process.exitCode = 1;
  });
}
