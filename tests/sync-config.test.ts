import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBaseUrl } from "../app/sync/config";

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
