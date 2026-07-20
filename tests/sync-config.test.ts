import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBaseUrl } from "../app/sync/config";

test("normalizeBaseUrl 修剪空白與尾斜線", () => {
  assert.equal(normalizeBaseUrl(" https://sync.example.com/ "), "https://sync.example.com");
  assert.equal(normalizeBaseUrl("https://sync.example.com/api/"), "https://sync.example.com/api");
  assert.equal(normalizeBaseUrl("http://localhost:8787"), "http://localhost:8787");
});

test("normalizeBaseUrl 拒絕非 http(s) 或空值", () => {
  assert.throws(() => normalizeBaseUrl(""));
  assert.throws(() => normalizeBaseUrl("ftp://x"));
  assert.throws(() => normalizeBaseUrl("not-a-url"));
});
