import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parsePersistedBoard, type BoardState } from "../app/board-model";

export type MigrationFingerprint = {
  revision: number;
  cardCount: number;
  completedCount: number;
  attachmentCount: number;
  tombstoneCount: number;
  completedAt: string[];
};

export function fingerprint(board: BoardState, revision: number): MigrationFingerprint {
  return {
    revision,
    cardCount: Object.keys(board.cards).length,
    completedCount: Object.values(board.cards).filter((card) => card.completedAt).length,
    attachmentCount: Object.values(board.cards).reduce((sum, card) => sum + card.attachments.length, 0),
    tombstoneCount: Object.keys(board.deletedCards).length,
    completedAt: Object.values(board.cards).flatMap((card) => card.completedAt ? [card.completedAt] : []).sort(),
  };
}

export function verifyMigration(legacy: MigrationFingerprint, migrated: MigrationFingerprint): string[] {
  return (Object.keys(legacy) as Array<keyof MigrationFingerprint>).flatMap((key) =>
    JSON.stringify(legacy[key]) === JSON.stringify(migrated[key]) ? [] : [`${key} mismatch`]
  );
}

async function readSnapshot(file: string): Promise<MigrationFingerprint> {
  const raw = JSON.parse(await readFile(file, "utf8")) as { revision: number; board: unknown };
  const parsed = parsePersistedBoard(JSON.stringify(raw.board));
  if (parsed.recovered || !Number.isInteger(raw.revision)) throw new Error(`${file} 不是有效的 Board snapshot。`);
  return fingerprint(parsed.board, raw.revision);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const legacy = args[args.indexOf("--legacy-file") + 1];
  const migrated = args[args.indexOf("--v2-file") + 1];
  if (!legacy || !migrated) throw new Error("需要 --legacy-file 與 --v2-file。");
  const before = await readSnapshot(legacy);
  const after = await readSnapshot(migrated);
  const errors = verifyMigration(before, after);
  process.stdout.write(JSON.stringify({ before, after, matches: errors.length === 0, errors }, null, 2) + "\n");
  if (errors.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Verification failed."}\n`);
    process.exitCode = 1;
  });
}
