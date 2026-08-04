import type { ApiContext } from "./projects";
import { json } from "./http";
import { sha256Hex } from "./logic";
import {
  createSessionToken,
  normalizeEmail,
  parsePassword,
  verifyPassword,
  type PasswordCredential,
} from "./passwords";
import { RequestError, readJsonObject } from "./validation";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_CREDENTIAL: PasswordCredential = {
  algorithm: "PBKDF2-SHA512",
  iterations: 210_000,
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  passwordHash:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
};

type LoginRow = {
  id: string;
  display_name: string;
  status: "active" | "disabled";
  algorithm: PasswordCredential["algorithm"] | null;
  iterations: number | null;
  salt: string | null;
  password_hash: string | null;
};

type AttemptRow = {
  failed_count: number;
  window_started_at: string;
  blocked_until: string | null;
};

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function loginError(status: 401 | 429, code: string, requestId: string): Response {
  return noStore(json(status, { error: code, requestId }, requestId));
}

async function attemptKey(request: Request, normalizedEmail: string): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return sha256Hex(`${normalizedEmail}\n${address}`);
}

async function enforceLoginRateLimit(
  database: D1Database,
  key: string,
  now: Date,
): Promise<void> {
  const row = await database.prepare(
    "SELECT failed_count, window_started_at, blocked_until FROM login_attempts WHERE attempt_key = ?",
  ).bind(key).first<AttemptRow>();
  if (row?.blocked_until && Date.parse(row.blocked_until) > now.getTime()) {
    throw new RequestError(429, "login_rate_limited");
  }
}

async function recordLoginFailure(
  database: D1Database,
  key: string,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const current = await database.prepare(
    "SELECT failed_count, window_started_at, blocked_until FROM login_attempts WHERE attempt_key = ?",
  ).bind(key).first<AttemptRow>();
  const withinWindow = current &&
    now.getTime() - Date.parse(current.window_started_at) < LOGIN_WINDOW_MS;
  const failedCount = withinWindow ? current.failed_count + 1 : 1;
  const blockedUntil = failedCount >= LOGIN_MAX_FAILURES
    ? new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString()
    : null;
  await database.prepare(
    `INSERT INTO login_attempts (
       attempt_key, failed_count, window_started_at, blocked_until, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET
       failed_count = excluded.failed_count,
       window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until,
       updated_at = excluded.updated_at`,
  ).bind(
    key,
    failedCount,
    withinWindow ? current.window_started_at : nowIso,
    blockedUntil,
    nowIso,
  ).run();
}

async function login(
  request: Request,
  database: D1Database,
  requestId: string,
): Promise<Response> {
  const body = await readJsonObject(request, ["email", "password"], 4096);
  const { normalizedEmail } = normalizeEmail(body.email);
  const password = parsePassword(body.password);
  const now = new Date();
  const key = await attemptKey(request, normalizedEmail);
  await enforceLoginRateLimit(database, key, now);

  const row = await database.prepare(
    `SELECT user_accounts.id, user_accounts.display_name, user_accounts.status,
            password_credentials.algorithm, password_credentials.iterations,
            password_credentials.salt, password_credentials.password_hash
     FROM user_accounts
     LEFT JOIN password_credentials
       ON password_credentials.user_id = user_accounts.id
     WHERE user_accounts.normalized_email = ?`,
  ).bind(normalizedEmail).first<LoginRow>();
  const credential = row?.algorithm && row.iterations && row.salt && row.password_hash
    ? {
      algorithm: row.algorithm,
      iterations: row.iterations,
      salt: row.salt,
      passwordHash: row.password_hash,
    }
    : DUMMY_CREDENTIAL;
  const valid = await verifyPassword(password, credential);
  if (!row || row.status !== "active" || !row.algorithm || !valid) {
    // Only known accounts create rate-limit state. This prevents an unauthenticated
    // attacker from growing D1 indefinitely with random email/IP combinations.
    if (row) await recordLoginFailure(database, key, now);
    return loginError(401, "invalid_credentials", requestId);
  }

  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();
  await database.batch([
    database.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(key),
    database.prepare(
      `DELETE FROM user_sessions
       WHERE user_id = ? AND (expires_at <= ? OR revoked_at IS NOT NULL)`,
    ).bind(row.id, now.toISOString()),
    database.prepare(
      `INSERT INTO user_sessions (
         id, user_id, token_hash, created_at, expires_at, last_used_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      crypto.randomUUID(),
      row.id,
      await sha256Hex(token),
      now.toISOString(),
      expiresAt,
    ),
  ]);
  return noStore(json(200, {
    token,
    expiresAt,
    user: { id: row.id, displayName: row.display_name },
    requestId,
  }, requestId));
}

export async function handlePublicAuthRequest(
  request: Request,
  database: D1Database,
  requestId: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/auth/login" || request.method !== "POST") return null;
  try {
    return await login(request, database, requestId);
  } catch (error) {
    if (error instanceof RequestError) {
      return error.status === 429
        ? loginError(429, error.code, requestId)
        : noStore(json(error.status, { error: error.code, requestId }, requestId));
    }
    throw error;
  }
}

export async function handleAuthenticatedAuthRequest(
  context: ApiContext,
): Promise<Response | null> {
  const pathname = new URL(context.request.url).pathname;
  if (pathname !== "/auth/logout" || context.request.method !== "POST") return null;
  if (context.user.tokenKind === "session") {
    await context.env.DB.prepare(
      "UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(new Date().toISOString(), context.user.tokenId).run();
  }
  return noStore(json(200, { ok: true, requestId: context.requestId }, context.requestId));
}
