import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  hashToken,
  type BootstrapTarget,
  validateToken,
} from "./bootstrap-sync-workspace";

type TokenAction = "create" | "list" | "revoke";

export type TokenCommand = {
  action: TokenAction;
  target: BootstrapTarget;
  userId: string;
  tokenId: string | null;
  label: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith("--") ? value : null;
}

export function parseTokenCommand(args: string[]): TokenCommand {
  const [action] = args;
  if (action !== "create" && action !== "list" && action !== "revoke") {
    throw new Error("第一個參數必須是 create、list 或 revoke。");
  }
  if (args.some((arg) => arg === "--token" || arg.startsWith("--token="))) {
    throw new Error("Token 不可使用命令列參數傳入；create 會從隱藏提示或 stdin 讀取。");
  }
  const allowed = new Set([
    "--target",
    "--user-id",
    "--token-id",
    "--label",
    "--confirm-production",
  ]);
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--") || !allowed.has(arg)) {
      throw new Error(`不支援的參數：${arg}`);
    }
    if (seen.has(arg)) throw new Error(`${arg} 不可重複。`);
    seen.add(arg);
    if (arg !== "--confirm-production") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少值。`);
      index += 1;
    }
  }

  const target = valueAfter(args, "--target");
  if (target !== "local" && target !== "staging" && target !== "production") {
    throw new Error("--target 必須明確指定 local、staging 或 production。");
  }
  if (target === "production" && !args.includes("--confirm-production")) {
    throw new Error("Production token 操作必須加上 --confirm-production。");
  }
  const userId = valueAfter(args, "--user-id") ?? "";
  if (!UUID_PATTERN.test(userId)) throw new Error("--user-id 必須是 UUID。");

  const tokenId = valueAfter(args, "--token-id");
  if (action !== "revoke" && tokenId) {
    throw new Error("--token-id 只適用於 revoke。");
  }
  if (action === "revoke" && (!tokenId || !UUID_PATTERN.test(tokenId))) {
    throw new Error("revoke 必須提供有效的 --token-id UUID。");
  }
  const label = valueAfter(args, "--label")?.trim() ?? null;
  if (action !== "create" && label) {
    throw new Error("--label 只適用於 create。");
  }
  if (action === "create" && (!label || label.length > 80)) {
    throw new Error("create 必須提供 1–80 個字元的 --label。");
  }
  return {
    action,
    target,
    userId,
    tokenId: action === "revoke" ? tokenId : null,
    label: action === "create" ? label : null,
  };
}

export function buildCreateTokenSql(input: {
  userId: string;
  tokenId: string;
  label: string;
  tokenHash: string;
}): string {
  if (!/^[0-9a-f]{64}$/.test(input.tokenHash)) {
    throw new Error("tokenHash 必須是小寫 SHA-256 hex。");
  }
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  return `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TEMP TABLE token_command_assertion (
  value INTEGER NOT NULL CHECK (value = 1)
);
INSERT INTO token_command_assertion (value)
SELECT COUNT(*) FROM user_accounts
WHERE id = ${quote(input.userId)} AND status = 'active';
INSERT INTO access_tokens (
  id, user_id, label, token_hash, token_kind, legacy_user_id,
  created_at, last_used_at, revoked_at
) VALUES (
  ${quote(input.tokenId)}, ${quote(input.userId)}, ${quote(input.label)},
  ${quote(input.tokenHash)}, 'personal', NULL, ${now}, NULL, NULL
);
DROP TABLE token_command_assertion;
COMMIT;
`.trim();
}

export function buildRevokeTokenSql(userId: string, tokenId: string): string {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  return `
BEGIN IMMEDIATE;
CREATE TEMP TABLE token_command_assertion (
  value INTEGER NOT NULL CHECK (value = 1)
);
UPDATE access_tokens
SET revoked_at = ${now}
WHERE id = ${quote(tokenId)}
  AND user_id = ${quote(userId)}
  AND token_kind = 'personal'
  AND revoked_at IS NULL;
INSERT INTO token_command_assertion (value) VALUES (changes());
DROP TABLE token_command_assertion;
COMMIT;
`.trim();
}

export function buildListTokensSql(userId: string): string {
  return `
SELECT id, label, token_kind, created_at, last_used_at, revoked_at
FROM access_tokens
WHERE user_id = ${quote(userId)}
ORDER BY created_at DESC, id DESC;
`.trim();
}

export function buildTokenWranglerArgs(
  target: BootstrapTarget,
  sqlPath: string,
): string[] {
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
  if (target === "staging") args.push("--env", "staging");
  return args;
}

async function readPipedToken(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) throw new Error("Token 輸入超過 4096 bytes。");
    chunks.push(buffer);
  }
  return validateToken(Buffer.concat(chunks).toString("utf8"));
}

async function readInteractiveToken(): Promise<string> {
  process.stderr.write("請輸入新的個人 access token（輸入內容不會顯示）：");
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
        return;
      }
      try {
        resolve(validateToken(value));
      } catch (validationError) {
        reject(validationError);
      }
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error("已取消 token 建立。"));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126 && value.length < 4096) {
          value += String.fromCharCode(byte);
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function execute(target: BootstrapTarget, sql: string): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-token-command-"));
  const sqlPath = path.join(directory, "command.sql");
  try {
    await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn("pnpm", buildTokenWranglerArgs(target, sqlPath), {
        cwd: process.cwd(),
        stdio: "inherit",
        env: {
          ...process.env,
          WRANGLER_LOG_PATH: path.resolve(".wrangler/wrangler.log"),
        },
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else {
          reject(new Error(
            signal
              ? `Wrangler 被 signal ${signal} 中止。`
              : `Wrangler 執行失敗（exit ${code ?? "unknown"}）。`,
          ));
        }
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = parseTokenCommand(args);
  if (command.action === "list") {
    await execute(command.target, buildListTokensSql(command.userId));
    return;
  }
  if (command.action === "revoke") {
    await execute(
      command.target,
      buildRevokeTokenSql(command.userId, command.tokenId!),
    );
    process.stdout.write(
      `Personal token revoked (${command.target}); userId=${command.userId}; tokenId=${command.tokenId}.\n`,
    );
    return;
  }

  const token = process.stdin.isTTY
    ? await readInteractiveToken()
    : await readPipedToken();
  const tokenId = randomUUID();
  await execute(command.target, buildCreateTokenSql({
    userId: command.userId,
    tokenId,
    label: command.label!,
    tokenHash: hashToken(token),
  }));
  process.stdout.write(
    `Personal token created (${command.target}); userId=${command.userId}; tokenId=${tokenId}; token=未顯示.\n`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Token 操作發生未知錯誤。"}\n`,
    );
    process.exitCode = 1;
  });
}
