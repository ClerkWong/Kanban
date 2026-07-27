import assert from "node:assert/strict";
import test from "node:test";
import {
  loadBoardRevisionWithLegacyMigration,
  normalizeBaseUrl,
} from "../app/sync/config";
import { syncRevisionKey } from "../app/projects/storage";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("normalizeBaseUrl 修剪空白與尾斜線", () => {
  assert.equal(normalizeBaseUrl(" https://sync.example.com/ "), "https://sync.example.com");
  assert.equal(normalizeBaseUrl("http://localhost:8787"), "http://localhost:8787");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
});

test("normalizeBaseUrl 拒絕不安全或帶額外成分的網址", () => {
  assert.throws(() => normalizeBaseUrl(""));
  assert.throws(() => normalizeBaseUrl("ftp://x"));
  assert.throws(() => normalizeBaseUrl("http://sync.example.com"));
  assert.throws(() => normalizeBaseUrl("not-a-url"));
  assert.throws(() => normalizeBaseUrl("https://sync.example.com/api/"));
  assert.throws(() => normalizeBaseUrl("https://user:secret@sync.example.com"));
  assert.throws(() => normalizeBaseUrl("https://sync.example.com?token=secret"));
  assert.throws(() => normalizeBaseUrl("https://sync.example.com/#settings"));
});

test("legacy global revision is read once and immediately moved to the Board v2 key", () => {
  const storage = new MemoryStorage();
  const boardA = "10000000-0000-4000-8000-000000000001";
  const boardB = "10000000-0000-4000-8000-000000000002";
  storage.setItem("kanban-sync-revision-v1", "7");

  assert.equal(loadBoardRevisionWithLegacyMigration(storage, boardA), 7);
  assert.equal(storage.getItem("kanban-sync-revision-v1"), null);
  assert.equal(storage.getItem(syncRevisionKey(boardA)), "7");

  assert.equal(loadBoardRevisionWithLegacyMigration(storage, boardB), 0);
  assert.equal(storage.getItem(syncRevisionKey(boardB)), "0");

  storage.setItem("kanban-sync-revision-v1", "99");
  assert.equal(loadBoardRevisionWithLegacyMigration(storage, boardA), 7);
  assert.equal(storage.getItem("kanban-sync-revision-v1"), "99");
});
