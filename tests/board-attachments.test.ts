import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  type AttachmentRef,
  assertBoardInvariants,
  createDemoBoard,
  diffAttachmentRefs,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
} from "../app/board-model";

function makeRef(id: string, overrides: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    id,
    type: "photo",
    fileName: `${id}.jpeg`,
    mimeType: "image/jpeg",
    size: 1024,
    createdAt: "2026-07-16T09:00:00.000Z",
    ...overrides,
  };
}

test("schema 版本為 3 且示範卡片帶空附件陣列", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 3);
  const board = createDemoBoard(new Date(2026, 6, 16));
  for (const card of Object.values(board.cards)) {
    assert.deepEqual(card.attachments, []);
  }
});

test("v1 資料無錯遷移為 v2，每張卡片補上 attachments: []", () => {
  const v1 = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 16))));
  v1.version = 1;
  for (const card of Object.values(v1.cards) as Array<Record<string, unknown>>) {
    delete card.attachments;
  }

  const parsed = parsePersistedBoard(JSON.stringify(v1));
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 3);
  assertBoardInvariants(parsed.board);
  for (const card of Object.values(parsed.board.cards)) {
    assert.deepEqual(card.attachments, []);
  }
});

test("非 1 或 2 的版本仍載入示範資料並回報錯誤", () => {
  const bogus = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 16))));
  bogus.version = 99;
  const parsed = parsePersistedBoard(JSON.stringify(bogus));
  assert.equal(parsed.recovered, true);
  assert.ok(parsed.error);
});

test("updateCard 寫入附件並在序列化往返後保留", () => {
  const board = createDemoBoard(new Date(2026, 6, 16));
  const withRef = updateCard(board, "card-roadmap", {
    attachments: [makeRef("att-1"), makeRef("att-2", { type: "audio", fileName: "att-2.m4a", mimeType: "audio/mp4" })],
  });
  const reloaded = parsePersistedBoard(serializeBoard(withRef));
  assert.equal(reloaded.error, null);
  assert.equal(reloaded.board.cards["card-roadmap"].attachments.length, 2);
  assert.equal(reloaded.board.cards["card-roadmap"].attachments[1].type, "audio");
});

test("附件正規化剔除格式錯誤與重複 id", () => {
  const board = createDemoBoard(new Date(2026, 6, 16));
  const dirty = updateCard(board, "card-roadmap", {
    attachments: [
      makeRef("att-1"),
      makeRef("att-1"),
      { id: "", type: "photo", fileName: "x.png", mimeType: "image/png", size: 1, createdAt: "" } as AttachmentRef,
      { id: "att-3", type: "video", fileName: "x.mp4", mimeType: "video/mp4", size: 1, createdAt: "" } as unknown as AttachmentRef,
      { id: "att-4", type: "photo", fileName: "", mimeType: "image/png", size: 1, createdAt: "" } as AttachmentRef,
    ],
  });
  assert.deepEqual(
    dirty.cards["card-roadmap"].attachments.map((ref) => ref.id),
    ["att-1"],
  );
});

test("diffAttachmentRefs 找出新增與移除", () => {
  const before = [makeRef("a"), makeRef("b")];
  const after = [makeRef("b"), makeRef("c")];
  const diff = diffAttachmentRefs(before, after);
  assert.deepEqual(diff.added.map((ref) => ref.id), ["c"]);
  assert.deepEqual(diff.removed.map((ref) => ref.id), ["a"]);
  const same = diffAttachmentRefs(before, [...before]);
  assert.deepEqual(same.added, []);
  assert.deepEqual(same.removed, []);
});
