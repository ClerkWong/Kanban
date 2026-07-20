import {
  BOARD_SCHEMA_VERSION,
  type BoardState,
  type Card,
  type Column,
  normalizeBoard,
} from "../board-model";

export function mergeBoards(local: BoardState, remote: BoardState): BoardState {
  const localWins = (local.lastSavedAt || "") >= (remote.lastSavedAt || "");
  const winner = localWins ? local : remote;
  const loser = localWins ? remote : local;

  const deletedCards: Record<string, string> = { ...loser.deletedCards };
  for (const [cardId, deletedAt] of Object.entries(winner.deletedCards)) {
    if (!deletedCards[cardId] || deletedCards[cardId] < deletedAt) {
      deletedCards[cardId] = deletedAt;
    }
  }

  const cards: Record<string, Card> = {};
  const allIds = new Set([...Object.keys(local.cards), ...Object.keys(remote.cards)]);
  for (const cardId of allIds) {
    const mine = local.cards[cardId];
    const theirs = remote.cards[cardId];
    const candidate =
      !mine ? theirs : !theirs ? mine : mine.updatedAt >= theirs.updatedAt ? mine : theirs;
    const tombstone = deletedCards[cardId];
    if (tombstone && tombstone >= candidate.updatedAt) {
      continue;
    }
    if (tombstone) {
      delete deletedCards[cardId];
    }
    cards[cardId] = candidate;
  }

  const columns: Column[] = winner.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((cardId) => cards[cardId]),
  }));
  const placed = new Set(columns.flatMap((column) => column.cardIds));
  for (const cardId of Object.keys(cards)) {
    if (placed.has(cardId)) {
      continue;
    }
    const loserColumn = loser.columns.find((column) => column.cardIds.includes(cardId));
    const target =
      (loserColumn && columns.find((column) => column.id === loserColumn.id)) ?? columns[0];
    target.cardIds.push(cardId);
    placed.add(cardId);
  }

  return normalizeBoard({
    version: BOARD_SCHEMA_VERSION,
    labels: winner.labels,
    cards,
    columns,
    deletedCards,
    lastSavedAt: winner.lastSavedAt >= loser.lastSavedAt ? winner.lastSavedAt : loser.lastSavedAt,
  });
}
