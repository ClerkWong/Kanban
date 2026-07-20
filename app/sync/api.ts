import type { SyncConfig } from "./config";

export class SyncApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SyncApiError";
    this.status = status;
  }
}

function authHeaders(config: SyncConfig): HeadersInit {
  return { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
}

export async function fetchRemoteBoard(
  config: SyncConfig,
): Promise<{ revision: number; board: unknown } | null> {
  const response = await fetch(`${config.baseUrl}/board`, { headers: authHeaders(config) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new SyncApiError(response.status, `GET /board 失敗（${response.status}）`);
  }
  return (await response.json()) as { revision: number; board: unknown };
}

export type PushResult =
  | { kind: "ok"; revision: number }
  | { kind: "conflict"; revision: number; board: unknown };

export async function pushRemoteBoard(
  config: SyncConfig,
  baseRevision: number,
  board: unknown,
): Promise<PushResult> {
  const response = await fetch(`${config.baseUrl}/board`, {
    method: "PUT",
    headers: authHeaders(config),
    body: JSON.stringify({ baseRevision, board }),
  });
  if (response.status === 409) {
    const body = (await response.json()) as { revision: number; board: unknown };
    return { kind: "conflict", revision: body.revision, board: body.board };
  }
  if (!response.ok) {
    throw new SyncApiError(response.status, `PUT /board 失敗（${response.status}）`);
  }
  const body = (await response.json()) as { revision: number };
  return { kind: "ok", revision: body.revision };
}
