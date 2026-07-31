import { parsePersistedBoard, type BoardState } from "../board-model";
import {
  ApiClientError,
  apiErrorFromResponse,
  apiPath,
  apiUrl,
  getBoard,
  readResponseJson,
} from "../projects/api";
import { isServerResourceId } from "../projects/model";
import type { BoardContext } from "../projects/types";
import type { SyncConfig } from "./config";

export class SyncApiError extends ApiClientError {
  constructor(status: number, message: string) {
    super(
      status,
      status === 401 ? "unauthorized" : status === 409 ? "conflict" : "server_error",
      `http_${status}`,
      message,
    );
    this.name = "SyncApiError";
  }
}

export type PushResult =
  | { kind: "ok"; revision: number }
  | { kind: "conflict"; revision: number; board: BoardState };

export type LegacyPushResult =
  | { kind: "ok"; revision: number }
  | { kind: "conflict"; revision: number; board: unknown };

function assertBoardContext(context: BoardContext): void {
  if (
    !isServerResourceId(context.workspaceId) ||
    !isServerResourceId(context.projectId) ||
    !isServerResourceId(context.boardId)
  ) {
    throw new ApiClientError(
      400,
      "server_error",
      "invalid_board_context",
      "BoardContext 必須包含有效的 Workspace、Project 與 Board UUID。",
    );
  }
}

function parseRevision(value: unknown, operation: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiClientError(
      502,
      "invalid_response",
      "invalid_response",
      `${operation} 回應缺少有效 revision。`,
    );
  }
  return value;
}

function parseStrictBoard(value: unknown, operation: string): BoardState {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ApiClientError(502, "invalid_response", "invalid_response", `${operation} 回應格式不正確。`);
  }
  const parsed = parsePersistedBoard(serialized);
  if (parsed.recovered) {
    throw new ApiClientError(502, "invalid_response", "invalid_response", `${operation} 回應格式不正確。`);
  }
  return parsed.board;
}

export async function fetchRemoteBoard(
  config: SyncConfig,
  context: BoardContext,
): Promise<{ revision: number; board: BoardState }> {
  assertBoardContext(context);
  const detail = await getBoard(config, context);
  return detail.content;
}

export async function pushRemoteBoard(
  config: SyncConfig,
  context: BoardContext,
  baseRevision: number,
  board: BoardState,
): Promise<PushResult> {
  assertBoardContext(context);
  const response = await fetch(
    apiUrl(
      config,
      apiPath("projects", context.projectId, "boards", context.boardId, "content"),
    ),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseRevision, board }),
    },
  );
  const body = await readResponseJson(response);
  if (response.status === 409) {
    const raw = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    if (raw?.error === "resource_archived") {
      throw apiErrorFromResponse(response, body, "更新看板");
    }
    return {
      kind: "conflict",
      revision: parseRevision(raw?.revision, "更新看板"),
      board: parseStrictBoard(raw?.board, "更新看板"),
    };
  }
  if (!response.ok) throw apiErrorFromResponse(response, body, "更新看板");
  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  return { kind: "ok", revision: parseRevision(raw?.revision, "更新看板") };
}

function legacyHeaders(config: SyncConfig): HeadersInit {
  return { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
}

/** Compatibility-only single-board API. Task 10 removes this from active sync. */
export async function fetchLegacyRemoteBoard(
  config: SyncConfig,
): Promise<{ revision: number; board: unknown } | null> {
  const response = await fetch(`${config.baseUrl}/board`, { headers: legacyHeaders(config) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new SyncApiError(response.status, `GET /board 失敗（${response.status}）`);
  }
  return await response.json() as { revision: number; board: unknown };
}

/** Compatibility-only single-board API. Task 10 removes this from active sync. */
export async function pushLegacyRemoteBoard(
  config: SyncConfig,
  baseRevision: number,
  board: unknown,
): Promise<LegacyPushResult> {
  const response = await fetch(`${config.baseUrl}/board`, {
    method: "PUT",
    headers: legacyHeaders(config),
    body: JSON.stringify({ baseRevision, board }),
  });
  if (response.status === 409) {
    const body = await response.json() as { revision: number; board: unknown };
    return { kind: "conflict", revision: body.revision, board: body.board };
  }
  if (!response.ok) {
    throw new SyncApiError(response.status, `PUT /board 失敗（${response.status}）`);
  }
  const body = await response.json() as { revision: number };
  return { kind: "ok", revision: body.revision };
}
