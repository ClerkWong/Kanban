import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_APP_CONFIG,
  loadAppConfig,
  parseAppConfig,
} from "../app/app-config";

test("parseAppConfig trims a valid custom title", () => {
  assert.deepEqual(parseAppConfig({ title: "  團隊工作台  " }), {
    title: "團隊工作台",
  });
});

test("parseAppConfig falls back for missing, blank, or oversized titles", () => {
  assert.deepEqual(parseAppConfig(null), DEFAULT_APP_CONFIG);
  assert.deepEqual(parseAppConfig({}), DEFAULT_APP_CONFIG);
  assert.deepEqual(parseAppConfig({ title: "   " }), DEFAULT_APP_CONFIG);
  assert.deepEqual(parseAppConfig({ title: "a".repeat(81) }), DEFAULT_APP_CONFIG);
});

test("loadAppConfig requests a fresh JSON value on startup", async () => {
  let requestedUrl = "";
  let requestedCache: RequestCache | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedCache = init?.cache;
    return new Response(JSON.stringify({ title: "Beta 工作看板" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  assert.deepEqual(await loadAppConfig("/app-config.json", fetcher), {
    title: "Beta 工作看板",
  });
  assert.equal(requestedUrl, "/app-config.json");
  assert.equal(requestedCache, "no-store");
});

test("loadAppConfig falls back when JSON cannot be loaded", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("offline");
  };

  assert.deepEqual(
    await loadAppConfig("/app-config.json", fetcher),
    DEFAULT_APP_CONFIG,
  );
});
