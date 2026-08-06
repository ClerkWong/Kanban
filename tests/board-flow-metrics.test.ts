import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_BOARD_SETTINGS,
  MAX_BLOCKED_MS,
  createDemoBoard,
  normalizeBoard,
  parsePersistedBoard,
  serializeBoard,
  type BoardState,
} from "../app/board-model";

test("schema v7 exposes flow fields with defaults", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 7);
  const board = createDemoBoard(new Date(2026, 7, 5));
  assert.deepEqual(board.settings, DEFAULT_BOARD_SETTINGS);
  for (const card of Object.values(board.cards)) {
    assert.equal(typeof card.columnEnteredAt, "string");
    assert.equal(card.blockedMs, 0);
    assert.equal(card.serviceClass, "standard");
  }
});

test("v6 data migrates without recomputing completedAt", () => {
  const legacy = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 7, 5)))) as BoardState;
  // 模擬 v6：拿掉 v7 欄位並降版
  const v6 = {
    ...legacy,
    version: 6,
    settings: undefined,
    cards: Object.fromEntries(
      Object.entries(legacy.cards).map(([id, card]) => {
        const { columnEnteredAt, startedAt, blockedMs, serviceClass, ...rest } = card;
        void columnEnteredAt; void startedAt; void blockedMs; void serviceClass;
        return [id, rest];
      }),
    ),
  };
  const { board, recovered } = parsePersistedBoard(JSON.stringify(v6));
  assert.equal(recovered, false);
  assert.equal(board.version, 7);
  assert.deepEqual(board.settings, DEFAULT_BOARD_SETTINGS);
  const done = board.cards["card-done"];
  assert.equal(done.completedAt, legacy.cards["card-done"].completedAt);
  assert.equal(done.startedAt, null);
  assert.equal(done.blockedMs, 0);
  assert.equal(done.serviceClass, "standard");
  assert.equal(done.columnEnteredAt, done.updatedAt);
});

test("normalize clamps invalid flow values", () => {
  const board = createDemoBoard(new Date(2026, 7, 5));
  const raw = JSON.parse(serializeBoard(board)) as BoardState;
  const cardId = Object.keys(raw.cards)[0];
  (raw.cards[cardId] as unknown as Record<string, unknown>).blockedMs = MAX_BLOCKED_MS * 2;
  (raw.cards[cardId] as unknown as Record<string, unknown>).serviceClass = "vip";
  (raw.cards[cardId] as unknown as Record<string, unknown>).columnEnteredAt = "not-a-date";
  (raw as unknown as Record<string, unknown>).settings = {
    agingWarnDays: 400, agingAlertDays: 0, expediteWipLimit: 1000,
  };
  const normalized = normalizeBoard(raw);
  assert.equal(normalized.cards[cardId].blockedMs, MAX_BLOCKED_MS);
  assert.equal(normalized.cards[cardId].serviceClass, "standard");
  assert.equal(normalized.cards[cardId].columnEnteredAt, normalized.cards[cardId].updatedAt);
  assert.equal(normalized.settings.agingWarnDays, 365);
  assert.equal(normalized.settings.agingAlertDays, 365);
  assert.equal(normalized.settings.expediteWipLimit, 99);
});
