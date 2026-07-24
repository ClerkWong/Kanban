import assert from "node:assert/strict";
import test from "node:test";
import { cacheDownloadedAttachment } from "../app/sync/attachment-api";
import type { PlatformCapabilities } from "../app/platform/types";

test("下載附件會以原始 fileName 寫入本機快取，且不涉及 upload queue", async () => {
  const originalFetch = globalThis.fetch;
  let written: { fileName: string; mimeType: string; size: number } | null = null;
  const platform = {
    attachments: {
      write: async (fileName: string, data: Blob | ArrayBuffer, mimeType: string) => {
        written = {
          fileName,
          mimeType,
          size: data instanceof Blob ? data.size : data.byteLength,
        };
      },
    },
  } as PlatformCapabilities;
  globalThis.fetch = async () => new Response(new Blob(["cached"], { type: "image/jpeg" }));
  try {
    const cached = await cacheDownloadedAttachment(
      { baseUrl: "https://sync.example", token: "secret" },
      platform,
      "att-original.jpeg",
      "image/jpeg",
    );
    assert.equal(cached, true);
    assert.deepEqual(written, { fileName: "att-original.jpeg", mimeType: "image/jpeg", size: 6 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("切換同步設定後，已開始的下載不寫入快取", async () => {
  const originalFetch = globalThis.fetch;
  let writes = 0;
  const platform = { attachments: { write: async () => { writes += 1; } } } as unknown as PlatformCapabilities;
  globalThis.fetch = async () => new Response(new Blob(["cached"]));
  try {
    const cached = await cacheDownloadedAttachment(
      { baseUrl: "https://sync.example", token: "secret" },
      platform,
      "att-original.jpeg",
      "image/jpeg",
      () => false,
    );
    assert.equal(cached, false);
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
