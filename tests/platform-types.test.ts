import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityError, base64ByteSize, extFromMime } from "../app/platform/types";

test("extFromMime 對常見型別給出副檔名，未知型別給 bin", () => {
  assert.equal(extFromMime("image/jpeg"), "jpeg");
  assert.equal(extFromMime("image/png"), "png");
  assert.equal(extFromMime("audio/mp4"), "m4a");
  assert.equal(extFromMime("audio/webm;codecs=opus"), "webm");
  assert.equal(extFromMime("audio/AAC"), "aac");
  assert.equal(extFromMime("application/x-unknown"), "bin");
});

test("base64ByteSize 以 base64 長度換算位元組數", () => {
  assert.equal(base64ByteSize(Buffer.from("hello").toString("base64")), 5);
  assert.equal(base64ByteSize(Buffer.from([1, 2, 3, 4]).toString("base64")), 4);
  assert.equal(base64ByteSize(""), 0);
});

test("CapabilityError 保留 reason 與訊息", () => {
  const error = new CapabilityError("permission-denied", "請開啟權限");
  assert.equal(error.reason, "permission-denied");
  assert.equal(error.message, "請開啟權限");
  assert.ok(error instanceof Error);
});
