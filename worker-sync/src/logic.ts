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

export type BoardPayload = Record<string, unknown> & {
  columns: unknown[];
  cards: Record<string, unknown>;
  version: number;
};

export function isBoardPayload(value: unknown): value is BoardPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const board = value as { columns?: unknown; cards?: unknown; version?: unknown };
  return (
    Array.isArray(board.columns) &&
    typeof board.cards === "object" &&
    board.cards !== null &&
    !Array.isArray(board.cards) &&
    typeof board.version === "number" &&
    Number.isInteger(board.version) &&
    board.version >= 1
  );
}

export function parseBoardPutPayload(
  value: Record<string, unknown>,
): { baseRevision: number; board: BoardPayload } | null {
  const baseRevision = value.baseRevision;
  if (
    typeof baseRevision !== "number" ||
    !Number.isInteger(baseRevision) ||
    baseRevision < 0 ||
    !isBoardPayload(value.board)
  ) {
    return null;
  }
  return { baseRevision, board: value.board };
}
