const workerUrl = process.env.KANBAN_SYNC_URL?.trim().replace(/\/+$/, "");
const token = process.env.KANBAN_SYNC_TOKEN?.trim();

if (!workerUrl || !token) {
  console.error(
    "請透過 KANBAN_SYNC_URL 與 KANBAN_SYNC_TOKEN 環境變數提供 staging 憑證；腳本不接受命令列 token。",
  );
  process.exit(2);
}

let boardUrl;
try {
  boardUrl = new URL("/board", `${workerUrl}/`);
} catch {
  console.error("KANBAN_SYNC_URL 不是有效網址。");
  process.exit(2);
}

if (boardUrl.protocol !== "https:" && boardUrl.hostname !== "localhost") {
  console.error("同步服務必須使用 HTTPS；只有 localhost 可使用 HTTP。");
  process.exit(2);
}

const preflight = await fetch(boardUrl, {
  method: "OPTIONS",
  headers: {
    Origin: "https://smoke-test.invalid",
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "authorization",
  },
});

if (preflight.status !== 204) {
  console.error(`CORS preflight 失敗：HTTP ${preflight.status}`);
  process.exit(1);
}

const response = await fetch(boardUrl, {
  headers: {
    Authorization: `Bearer ${token}`,
    Origin: "https://smoke-test.invalid",
  },
});

if (response.status !== 200 && response.status !== 404) {
  console.error(`讀取看板失敗：HTTP ${response.status}`);
  process.exit(1);
}

const contentType = response.headers.get("content-type") ?? "";
if (!contentType.includes("application/json")) {
  console.error(`回應格式錯誤：${contentType || "缺少 Content-Type"}`);
  process.exit(1);
}

const corsOrigin = response.headers.get("access-control-allow-origin");
if (!corsOrigin) {
  console.error("回應缺少 Access-Control-Allow-Origin。");
  process.exit(1);
}

const payload = await response.json();
if (response.status === 200) {
  if (!Number.isInteger(payload.revision) || typeof payload.board !== "object") {
    console.error("看板回應缺少有效的 revision 或 board。");
    process.exit(1);
  }
  console.log(`同步服務 smoke test 通過；目前 revision=${payload.revision}。`);
} else if (payload.error === "empty") {
  console.log("同步服務 smoke test 通過；staging 看板目前為空。");
} else {
  console.error("空看板回應格式不符合預期。");
  process.exit(1);
}
