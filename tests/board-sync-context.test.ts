import assert from "node:assert/strict";
import test from "node:test";

import type { BoardSyncIdentity } from "../app/sync/useBoardSync";
import { BoardSyncGuard } from "../app/sync/useBoardSync";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const projectA = "20000000-0000-4000-8000-000000000002";
const projectB = "20000000-0000-4000-8000-000000000003";
const boardA = "20000000-0000-4000-8000-000000000004";
const boardB = "20000000-0000-4000-8000-000000000005";
const userA = "20000000-0000-4000-8000-000000000006";
const userB = "20000000-0000-4000-8000-000000000007";

function identity(overrides: Partial<BoardSyncIdentity> = {}): BoardSyncIdentity {
  return {
    baseUrl: "https://sync.example",
    token: "token-a",
    userId: userA,
    context: { workspaceId, projectId: projectA, boardId: boardA },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("same Board scope keeps its generation while token/user/endpoint/context switches invalidate it", () => {
  const guard = new BoardSyncGuard();
  const first = identity();
  const generation = guard.activate(first);
  assert.equal(guard.activate(identity()), generation);
  assert.equal(guard.isCurrent(first, generation), true);

  const variants = [
    identity({ token: "token-b" }),
    identity({ userId: userB }),
    identity({ baseUrl: "https://other.example" }),
    identity({ context: { workspaceId, projectId: projectA, boardId: boardB } }),
    identity({ context: { workspaceId, projectId: projectB, boardId: boardA } }),
  ];
  let previous = generation;
  for (const variant of variants) {
    const next = guard.activate(variant);
    assert.ok(next > previous);
    assert.equal(guard.isCurrent(first, generation), false);
    assert.equal(guard.isCurrent(variant, next), true);
    previous = next;
  }
});

test("a response from Board A cannot write after the active scope switches to Board B", async () => {
  const guard = new BoardSyncGuard();
  const scopeA = identity();
  const generationA = guard.activate(scopeA);
  const responseA = deferred<string>();
  const writes: string[] = [];

  const lateWrite = responseA.promise.then((value) => {
    if (guard.isCurrent(scopeA, generationA)) writes.push(value);
  });

  const scopeB = identity({
    context: { workspaceId, projectId: projectA, boardId: boardB },
  });
  const generationB = guard.activate(scopeB);
  responseA.resolve("Board A remote payload");
  await lateWrite;

  assert.deepEqual(writes, []);
  assert.equal(guard.isCurrent(scopeB, generationB), true);
});

test("independent Board guards allow Board A/B requests to complete concurrently", async () => {
  const guardA = new BoardSyncGuard();
  const guardB = new BoardSyncGuard();
  const scopeA = identity();
  const scopeB = identity({
    context: { workspaceId, projectId: projectA, boardId: boardB },
  });
  const generationA = guardA.activate(scopeA);
  const generationB = guardB.activate(scopeB);
  const a = deferred<string>();
  const b = deferred<string>();
  const writes: string[] = [];

  const both = Promise.all([
    a.promise.then((value) => {
      if (guardA.isCurrent(scopeA, generationA)) writes.push(value);
    }),
    b.promise.then((value) => {
      if (guardB.isCurrent(scopeB, generationB)) writes.push(value);
    }),
  ]);
  b.resolve("B");
  a.resolve("A");
  await both;
  assert.deepEqual(writes.sort(), ["A", "B"]);
});

test("invalidating a guard suppresses unmounted hook responses", () => {
  const guard = new BoardSyncGuard();
  const scope = identity();
  const generation = guard.activate(scope);
  guard.invalidate();
  assert.equal(guard.isCurrent(scope, generation), false);
});
