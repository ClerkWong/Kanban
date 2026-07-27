import type { ProjectRole } from "./db-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RequestError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 413 | 503,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RequestError(400, `invalid_${field}`);
  }
  return value;
}

export function normalizeName(value: unknown): { name: string; normalizedName: string } {
  if (typeof value !== "string") throw new RequestError(400, "invalid_name");
  const name = value.trim();
  if (!name || name.length > 80) throw new RequestError(400, "invalid_name");
  return {
    name,
    normalizedName: name.normalize("NFKC").toLocaleLowerCase("en-US"),
  };
}

export function parseProjectRole(value: unknown): ProjectRole {
  if (value !== "manager" && value !== "contributor" && value !== "viewer") {
    throw new RequestError(400, "invalid_role");
  }
  return value;
}

export async function readJsonObject(
  request: Request,
  allowedKeys: readonly string[],
): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > 65_536) {
    throw new RequestError(413, "request_too_large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 65_536) {
    throw new RequestError(413, "request_too_large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RequestError(400, "invalid_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "invalid_payload");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new RequestError(400, "unknown_field");
  }
  return record;
}

export function isConstraintConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed");
}
