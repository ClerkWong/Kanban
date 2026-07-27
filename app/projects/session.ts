import type { SyncConfig } from "../sync/config";
import { isWorkspaceRole, isUuid } from "./model";
import { ApiClientError, requestJson } from "./api";
import type { WorkspaceRole } from "./types";

export type RuntimeSession = {
  user: {
    id: string;
    displayName: string;
    tokenKind: "personal" | "legacy";
  };
  workspaces: Array<{
    workspaceId: string;
    role: WorkspaceRole;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseRuntimeSession(value: unknown): RuntimeSession | null {
  const raw = asRecord(value);
  const user = asRecord(raw?.user);
  if (
    !raw ||
    !user ||
    !isUuid(user.id) ||
    typeof user.displayName !== "string" ||
    !user.displayName ||
    (user.tokenKind !== "personal" && user.tokenKind !== "legacy") ||
    !Array.isArray(raw.workspaces)
  ) {
    return null;
  }
  const workspaces = raw.workspaces.flatMap((value) => {
    const item = asRecord(value);
    return item && isUuid(item.workspaceId) && isWorkspaceRole(item.role)
      ? [{ workspaceId: item.workspaceId, role: item.role }]
      : [];
  });
  if (workspaces.length !== raw.workspaces.length) return null;
  return {
    user: { id: user.id, displayName: user.displayName, tokenKind: user.tokenKind },
    workspaces,
  };
}

export async function fetchRuntimeSession(config: SyncConfig): Promise<RuntimeSession> {
  const session = parseRuntimeSession(await requestJson(config, "/me", "驗證同步身分"));
  if (!session) {
    throw new ApiClientError(
      502,
      "invalid_response",
      "invalid_response",
      "同步伺服器身分回應格式不正確。",
    );
  }
  return session;
}

/** Validates the replacement as a live personal token before asking the
 * server to revoke the currently authenticated legacy shared token. */
export async function replaceLegacyToken(
  legacyConfig: SyncConfig,
  newToken: string,
): Promise<RuntimeSession> {
  const replacementConfig = { ...legacyConfig, token: newToken };
  const replacement = await fetchRuntimeSession(replacementConfig);
  if (replacement.user.tokenKind !== "personal") {
    throw new Error("替代 token 必須是有效的個人 token。");
  }
  await requestJson(
    legacyConfig,
    "/me/replace-legacy-token",
    "換發 legacy token",
    { method: "POST", body: JSON.stringify({ newToken }) },
  );
  return replacement;
}
