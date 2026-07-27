import { sha256Hex } from "./logic";

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  tokenId: string;
  tokenKind: "personal" | "legacy";
};

type AuthRow = {
  id: string;
  display_name: string;
  token_id: string;
  token_kind: "personal" | "legacy";
};

export async function authenticate(
  request: Request,
  database: D1Database,
): Promise<AuthenticatedUser | null> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await database.prepare(
    `SELECT user_accounts.id, user_accounts.display_name, access_tokens.id AS token_id,
            access_tokens.token_kind
     FROM access_tokens
     INNER JOIN user_accounts ON user_accounts.id = access_tokens.user_id
     WHERE access_tokens.token_hash = ?
       AND access_tokens.revoked_at IS NULL
       AND user_accounts.status = 'active'`,
  ).bind(tokenHash).first<AuthRow>();
  return row
    ? {
      id: row.id,
      displayName: row.display_name,
      tokenId: row.token_id,
      tokenKind: row.token_kind,
    }
    : null;
}

export function scheduleLastUsedUpdate(
  database: D1Database,
  ctx: ExecutionContext,
  user: AuthenticatedUser,
  requestId: string,
): void {
  const update = database.prepare(
    "UPDATE access_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).bind(new Date().toISOString(), user.tokenId).run().catch((error: unknown) => {
    console.error(JSON.stringify({
      event: "token_last_used_update_failed",
      requestId,
      tokenId: user.tokenId,
      message: error instanceof Error ? error.message : String(error),
    }));
  });
  ctx.waitUntil(update);
}
