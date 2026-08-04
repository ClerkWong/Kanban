import {
  apiErrorFromResponse,
  apiUrl,
  readResponseJson,
  requestJson,
} from "../projects/api";
import { normalizeBaseUrl, type SyncConfig } from "../sync/config";

type LoginResult = {
  token: string;
  expiresAt: string;
  user: { id: string; displayName: string };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function loginWithPassword(input: {
  baseUrl: string;
  email: string;
  password: string;
}): Promise<{ config: SyncConfig; login: LoginResult }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const response = await fetch(apiUrl({ baseUrl }, "/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw apiErrorFromResponse(response, body, "登入");
  const raw = asRecord(body);
  const user = asRecord(raw?.user);
  if (
    !raw ||
    typeof raw.token !== "string" ||
    raw.token.length < 32 ||
    typeof raw.expiresAt !== "string" ||
    !user ||
    typeof user.id !== "string" ||
    typeof user.displayName !== "string"
  ) {
    throw new Error("登入伺服器回應格式不正確。");
  }
  return {
    config: { baseUrl, token: raw.token },
    login: {
      token: raw.token,
      expiresAt: raw.expiresAt,
      user: { id: user.id, displayName: user.displayName },
    },
  };
}

export async function logoutSession(config: SyncConfig): Promise<void> {
  await requestJson(config, "/auth/logout", "登出", { method: "POST" });
}
