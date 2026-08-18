import assert from "node:assert/strict";
import test from "node:test";
import {
  createDraft,
  draftFromCard,
  draftToCardInput,
  findNearestFocus,
  getBoardOverlayKey,
  isImeComposing,
  locateCard,
} from "../app/components/board/shared";
import { createDemoBoard, updateCard } from "../app/board-model";

test("createDraft 以空白欄位與中優先級起始", () => {
  const draft = createDraft();
  assert.equal(draft.title, "");
  assert.equal(draft.priority, "medium");
  assert.deepEqual(draft.labelIds, []);
  assert.deepEqual(draft.assigneeUserIds, []);
  assert.equal(draft.blocked, false);
  assert.equal(draft.blockedReason, "");
  assert.deepEqual(draft.checklist, []);
  assert.deepEqual(draft.attachments, []);
});

test("draftFromCard 複製欄位並以逗號串接成員、深拷貝清單", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const card = board.cards["card-roadmap"];
  const draft = draftFromCard(card);
  assert.equal(draft.title, card.title);
  assert.equal(draft.members, card.members.join(", "));
  assert.deepEqual(draft.assigneeUserIds, card.assigneeUserIds);
  assert.notEqual(draft.assigneeUserIds, card.assigneeUserIds);
  assert.notEqual(draft.checklist, card.checklist);
  assert.notEqual(draft.checklist[0], card.checklist[0]);

  const boardWithRef = updateCard(board, card.id, {
    attachments: [{
      id: "att-1", type: "photo", fileName: "att-1.jpeg",
      mimeType: "image/jpeg", size: 10, createdAt: "2026-07-16T09:00:00.000Z",
    }],
    assigneeUserIds: ["user-a"],
    assignmentWindows: [
      { userId: "user-a", startDate: "2026-08-07", endDate: "2026-08-13" },
    ],
  });
  const draftWithRef = draftFromCard(boardWithRef.cards[card.id]);
  assert.equal(draftWithRef.attachments.length, 1);
  assert.notEqual(draftWithRef.attachments, boardWithRef.cards[card.id].attachments);
  assert.equal(draftWithRef.assignmentWindows.length, 1);
  assert.notEqual(
    draftWithRef.assignmentWindows,
    boardWithRef.cards[card.id].assignmentWindows,
  );
  assert.notEqual(
    draftWithRef.assignmentWindows[0],
    boardWithRef.cards[card.id].assignmentWindows[0],
  );
});

test("draftToCardInput only preserves a blocker reason while blocked", () => {
  const blocked = draftToCardInput({
    ...createDraft(),
    blocked: true,
    blockedReason: " 等待法務確認 ",
  });
  const clear = draftToCardInput({
    ...createDraft(),
    blocked: false,
    blockedReason: "不應保存",
  });

  assert.equal(blocked.blockedReason, "等待法務確認");
  assert.equal(clear.blockedReason, "");
});

test("draftToCardInput 修剪成員字串並剔除空項", () => {
  const draft = {
    ...createDraft(),
    assigneeUserIds: ["user-a", "user-b", "user-a"],
    members: " 雅婷 , , Kai ",
  };
  const input = draftToCardInput(draft);
  assert.deepEqual(input.assigneeUserIds, ["user-a", "user-b"]);
  assert.deepEqual(input.members, ["雅婷", "Kai"]);
});

test("draftToCardInput 丟棄未指派者的投入期間", () => {
  const draft = {
    ...createDraft(),
    assigneeUserIds: ["user-a"],
    assignmentWindows: [
      { userId: "user-a", startDate: "2026-08-07", endDate: "2026-08-13" },
      { userId: "user-b", startDate: "2026-08-07", endDate: "2026-08-12" },
    ],
  };
  assert.deepEqual(draftToCardInput(draft).assignmentWindows, [
    { userId: "user-a", startDate: "2026-08-07", endDate: "2026-08-13" },
  ]);
});

test("draftToCardInput 帶出附件參照", () => {
  const draft = {
    ...createDraft(),
    title: "帶附件",
    attachments: [{
      id: "att-9", type: "audio" as const, fileName: "att-9.m4a",
      mimeType: "audio/mp4", size: 99, createdAt: "2026-07-16T09:00:00.000Z",
    }],
  };
  assert.deepEqual(draftToCardInput(draft).attachments.map((ref) => ref.id), ["att-9"]);
});

test("locateCard 回傳欄與卡索引，找不到回傳 null", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const position = locateCard(board, "card-roadmap");
  assert.ok(position);
  assert.equal(typeof position.columnIndex, "number");
  assert.equal(board.columns[position.columnIndex].cardIds[position.cardIndex], "card-roadmap");
  assert.equal(locateCard(board, "card-不存在"), null);
});

test("findNearestFocus 優先取同欄下一張，否則上一張，否則 null", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const column = board.columns.find((entry) => entry.cardIds.length >= 2);
  assert.ok(column);
  const [first, second] = column.cardIds;
  assert.equal(findNearestFocus(board.columns, first), second);
  assert.equal(findNearestFocus(board.columns, "card-不存在"), null);
});

test("編輯內容更新時維持相同 overlay key，避免重新聚焦對話框", () => {
  const firstDetail = { mode: "add" as const, columnId: "todo", draft: createDraft() };
  const updatedDetail = {
    ...firstDetail,
    draft: { ...firstDetail.draft, title: "注音輸入" },
  };

  assert.equal(getBoardOverlayKey({
    detail: firstDetail,
    confirmAction: null,
    syncOpen: false,
    reportOpen: false,
  }), "detail");
  assert.equal(getBoardOverlayKey({
    detail: updatedDetail,
    confirmAction: null,
    syncOpen: false,
    reportOpen: false,
  }), "detail");
  assert.equal(getBoardOverlayKey({
    detail: null,
    confirmAction: null,
    syncOpen: false,
    reportOpen: false,
  }), null);
});

test("IME 組字期間辨識標準旗標與 Safari keyCode 229", () => {
  assert.equal(isImeComposing({ isComposing: true, keyCode: 0 }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 13 }), false);
});

test("draftFromCard and draftToCardInput round-trip parentCardId", () => {
  const board = createDemoBoard();
  const [parentId, childId] = Object.keys(board.cards);
  const linked = updateCard(board, childId, { parentCardId: parentId });
  const draft = draftFromCard(linked.cards[childId]);
  assert.equal(draft.parentCardId, parentId);
  assert.equal(draftToCardInput(draft).parentCardId, parentId);
});

test("createDraft starts with no parent", () => {
  assert.equal(createDraft().parentCardId, null);
});
