import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ATTACHMENT_BYTES, base64ByteSize } from "../app/platform/types";

test("client attachment limit uses the shared 10 MiB value and rejects only values above it", () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024);
  const atLimit = Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64");
  const aboveLimit = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64");
  assert.equal(base64ByteSize(atLimit) <= MAX_ATTACHMENT_BYTES, true);
  assert.equal(base64ByteSize(aboveLimit) > MAX_ATTACHMENT_BYTES, true);
});
