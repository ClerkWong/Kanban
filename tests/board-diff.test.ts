import assert from "node:assert/strict";
import test from "node:test";

import { diffBoardStates } from "../worker-sync/src/board-diff";

type TestCard = {
  title: string;
  description: string;
  priority: string;
  labelIds: string[];
  dueDate: string;
  checklist: Array<{ id: string; text: string; done: boolean }>;
  assigneeUserIds: string[];
  blocked: boolean;
  blockedReason: string;
  blockedAt: string | null;
  members: string[];
  attachments: Array<Record<string, unknown>>;
  completedAt: string | null;
};

function card(overrides: Partial<TestCard> = {}): TestCard {
  return {
    title: "Card",
    description: "",
    priority: "medium",
    labelIds: [],
    dueDate: "",
    checklist: [],
    assigneeUserIds: [],
    blocked: false,
    blockedReason: "",
    blockedAt: null,
    members: [],
    attachments: [],
    completedAt: null,
    ...overrides,
  };
}

function board(
  cards: Record<string, TestCard>,
  todo: string[],
  done: string[],
): Record<string, unknown> {
  return {
    version: 6,
    columns: [
      { id: "todo", cardIds: todo },
      { id: "done", cardIds: done },
    ],
    cards,
  };
}

test("diffs only the committed before/after board and redacts sensitive values", () => {
  const before = board({
    edited: card({
      title: "Old title",
      description: "old-private-description",
      attachments: [{
        id: "attachment-old",
        type: "image/png",
        fileName: "private-before.png",
        bytes: "base64-secret-before",
      }],
    }),
    deleted: card({ title: "Deleted card" }),
    reopened: card({
      title: "Reopen",
      completedAt: "2026-07-01T00:00:00.000Z",
    }),
  }, ["edited", "deleted"], ["reopened"]);
  const after = board({
    edited: card({
      title: "New title",
      description: "new-private-description",
      dueDate: "2026-08-01",
      completedAt: "2026-07-27T01:00:00.000Z",
      attachments: [{
        id: "attachment-new",
        type: "image/webp",
        fileName: "private-after.webp",
        bytes: "base64-secret-after",
      }],
    }),
    created: card({ title: "Created card" }),
    reopened: card({ title: "Reopen" }),
  }, ["created", "reopened"], ["edited"]);

  const diff = diffBoardStates(before, after);
  const kinds = diff.changes.map((change) => change.kind);
  assert.ok(kinds.includes("card.created"));
  assert.ok(kinds.includes("card.updated"));
  assert.ok(kinds.includes("card.moved"));
  assert.ok(kinds.includes("card.completed"));
  assert.ok(kinds.includes("card.reopened"));
  assert.ok(kinds.includes("card.deleted"));
  assert.ok(kinds.includes("attachment.added"));
  assert.ok(kinds.includes("attachment.removed"));
  assert.deepEqual(
    diff.changes.find(
      (change) => change.kind === "card.updated" && change.cardId === "edited",
    ),
    {
      kind: "card.updated",
      cardId: "edited",
      title: "New title",
      fields: ["title", "description", "dueDate"],
    },
  );

  const serialized = JSON.stringify(diff);
  for (const secret of [
    "old-private-description",
    "new-private-description",
    "private-before.png",
    "private-after.webp",
    "base64-secret-before",
    "base64-secret-after",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("caps details at 200 while preserving complete counts", () => {
  const cards = Object.fromEntries(
    Array.from({ length: 205 }, (_, index) => [
      `card-${String(index).padStart(3, "0")}`,
      card({ title: `Card ${index}` }),
    ]),
  );
  const diff = diffBoardStates(board({}, [], []), board(cards, Object.keys(cards), []));

  assert.equal(diff.changes.length, 200);
  assert.equal(diff.counts["card.created"], 205);
  assert.equal(diff.truncated, true);
});

test("records canonical multi-assignee changes without logging display names", () => {
  const before = board({
    assigned: card({ assigneeUserIds: ["user-a"] }),
  }, ["assigned"], []);
  const after = board({
    assigned: card({ assigneeUserIds: ["user-a", "user-b"] }),
  }, ["assigned"], []);

  const diff = diffBoardStates(before, after);

  assert.deepEqual(diff.changes, [{
    kind: "card.updated",
    cardId: "assigned",
    title: "Card",
    fields: ["assigneeUserIds"],
  }]);
});

test("records blocker field names without logging the private blocker reason", () => {
  const before = board({ blocked: card() }, ["blocked"], []);
  const after = board({
    blocked: card({
      blocked: true,
      blockedReason: "客戶尚未提供 production secret",
      blockedAt: "2026-08-04T09:00:00.000Z",
    }),
  }, ["blocked"], []);

  const diff = diffBoardStates(before, after);

  assert.deepEqual(diff.changes, [{
    kind: "card.updated",
    cardId: "blocked",
    title: "Card",
    fields: ["blocked", "blockedReason", "blockedAt"],
  }]);
  assert.equal(JSON.stringify(diff).includes("production secret"), false);
});
