export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type PutDecision =
  | { kind: "create" }
  | { kind: "update"; nextRevision: number }
  | { kind: "conflict" };

export function decideBoardPut(current: number | null, baseRevision: number): PutDecision {
  if (current === null) {
    return baseRevision === 0 ? { kind: "create" } : { kind: "conflict" };
  }
  return baseRevision === current
    ? { kind: "update", nextRevision: current + 1 }
    : { kind: "conflict" };
}

export function isBoardPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const board = value as { columns?: unknown; cards?: unknown; version?: unknown };
  return (
    Array.isArray(board.columns) &&
    typeof board.cards === "object" &&
    board.cards !== null &&
    typeof board.version === "number" &&
    Number.isInteger(board.version) &&
    board.version >= 1
  );
}
