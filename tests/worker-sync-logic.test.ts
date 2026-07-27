import assert from "node:assert/strict";
import test from "node:test";
import {
  decideBoardPut,
  isBoardPayload,
  parseBoardPutPayload,
  sha256Hex,
} from "../worker-sync/src/logic";

test("sha256Hex 產生穩定的 64 字元十六進位雜湊", async () => {
  const hash = await sha256Hex("test-token");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await sha256Hex("test-token"));
  assert.notEqual(hash, await sha256Hex("other-token"));
});

test("decideBoardPut：空庫 base 0 建立、有庫 base 相符更新、其餘衝突", () => {
  assert.deepEqual(decideBoardPut(null, 0), { kind: "create" });
  assert.deepEqual(decideBoardPut(null, 3), { kind: "conflict" });
  assert.deepEqual(decideBoardPut(7, 7), { kind: "update", nextRevision: 8 });
  assert.deepEqual(decideBoardPut(7, 6), { kind: "conflict" });
  assert.deepEqual(decideBoardPut(7, 8), { kind: "conflict" });
});

test("isBoardPayload 過濾非看板形狀", () => {
  assert.equal(isBoardPayload({ columns: [], cards: {}, version: 3 }), true);
  assert.equal(isBoardPayload({ columns: {}, cards: {}, version: 3 }), false);
  assert.equal(isBoardPayload({ columns: [], cards: [], version: 3 }), false);
  assert.equal(isBoardPayload({ columns: [], cards: {} }), false);
  assert.equal(isBoardPayload(null), false);
  assert.equal(isBoardPayload("x"), false);
});

test("parseBoardPutPayload 驗證每個 Board 的 base revision 與內容", () => {
  const board = { columns: [], cards: {}, version: 3 };
  assert.deepEqual(parseBoardPutPayload({ baseRevision: 0, board }), {
    baseRevision: 0,
    board,
  });
  assert.equal(parseBoardPutPayload({ baseRevision: -1, board }), null);
  assert.equal(parseBoardPutPayload({ baseRevision: 1.5, board }), null);
  assert.equal(parseBoardPutPayload({ baseRevision: "0", board }), null);
  assert.equal(parseBoardPutPayload({ baseRevision: null, board }), null);
  assert.equal(parseBoardPutPayload({ baseRevision: 0, board: {} }), null);
});
