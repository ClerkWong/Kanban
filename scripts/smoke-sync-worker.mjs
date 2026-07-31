import { pathToFileURL } from "node:url";

function endpoint(workerUrl, pathname) {
  return new URL(pathname, `${workerUrl}/`);
}

async function readJsonResponse(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://smoke-test.invalid",
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`回應格式錯誤：${contentType || "缺少 Content-Type"}`);
  }
  if (!response.headers.get("access-control-allow-origin")) {
    throw new Error("回應缺少 Access-Control-Allow-Origin。");
  }
  return { response, payload: await response.json() };
}

export async function runSmoke({
  workerUrl,
  token,
  fetchImpl = fetch,
  log = console.log,
}) {
  let baseUrl;
  try {
    baseUrl = new URL(`${workerUrl.replace(/\/+$/, "")}/`);
  } catch {
    throw new Error("KANBAN_SYNC_URL 不是有效網址。");
  }
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    throw new Error("同步服務必須使用 HTTPS；只有 localhost 可使用 HTTP。");
  }

  const meUrl = endpoint(baseUrl.href, "/me");
  const preflight = await fetchImpl(meUrl, {
    method: "OPTIONS",
    headers: {
      Origin: "https://smoke-test.invalid",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  if (preflight.status !== 204) {
    throw new Error(`CORS preflight 失敗：HTTP ${preflight.status}`);
  }

  const me = await readJsonResponse(fetchImpl, meUrl, token);
  if (me.response.status !== 200) {
    throw new Error(`讀取使用者身份失敗：HTTP ${me.response.status}`);
  }
  if (
    typeof me.payload?.user?.id !== "string" ||
    me.payload.user.tokenKind !== "personal" ||
    !Array.isArray(me.payload.workspaces)
  ) {
    throw new Error("使用者身份回應格式不符合 personal token contract。");
  }

  const projects = await readJsonResponse(fetchImpl, endpoint(baseUrl.href, "/projects"), token);
  if (projects.response.status !== 200) {
    throw new Error(`讀取專案清單失敗：HTTP ${projects.response.status}`);
  }
  if (!Array.isArray(projects.payload?.projects)) {
    throw new Error("專案清單回應格式不符合預期。");
  }

  let sampledBoards = 0;
  const firstProject = projects.payload.projects[0];
  if (firstProject !== undefined) {
    if (typeof firstProject?.id !== "string") {
      throw new Error("專案清單缺少有效的 Project ID。");
    }
    const boards = await readJsonResponse(
      fetchImpl,
      endpoint(baseUrl.href, `/projects/${firstProject.id}/boards?status=active`),
      token,
    );
    if (boards.response.status !== 200 || !Array.isArray(boards.payload?.boards)) {
      throw new Error(`讀取看板清單失敗：HTTP ${boards.response.status}`);
    }
    const firstBoard = boards.payload.boards[0];
    if (firstBoard !== undefined) {
      if (typeof firstBoard?.id !== "string") {
        throw new Error("看板清單缺少有效的 Board ID。");
      }
      const detail = await readJsonResponse(
        fetchImpl,
        endpoint(baseUrl.href, `/projects/${firstProject.id}/boards/${firstBoard.id}`),
        token,
      );
      if (
        detail.response.status !== 200 ||
        !Number.isInteger(detail.payload?.board?.content?.revision) ||
        typeof detail.payload?.board?.content?.board !== "object" ||
        detail.payload.board.content.board === null
      ) {
        throw new Error(`讀取看板內容失敗：HTTP ${detail.response.status}`);
      }
      sampledBoards = 1;
    }
  }

  const result = {
    userId: me.payload.user.id,
    workspaceCount: me.payload.workspaces.length,
    projectCount: projects.payload.projects.length,
    sampledBoards,
  };
  log(
    `同步服務 smoke test 通過；workspaces=${result.workspaceCount}，projects=${result.projectCount}，sampledBoards=${result.sampledBoards}。`,
  );
  return result;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const workerUrl = process.env.KANBAN_SYNC_URL?.trim();
  const token = process.env.KANBAN_SYNC_TOKEN?.trim();
  if (!workerUrl || !token) {
    console.error(
      "請透過 KANBAN_SYNC_URL 與 KANBAN_SYNC_TOKEN 環境變數提供 staging 憑證；腳本不接受命令列 token。",
    );
    process.exitCode = 2;
  } else {
    try {
      await runSmoke({ workerUrl, token });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "同步服務 smoke test 失敗。");
      process.exitCode = 1;
    }
  }
}
