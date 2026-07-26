import { authenticate, scheduleLastUsedUpdate } from "./auth";
import { json, logRequestError, responseHeaders } from "./http";
import { routeRequest } from "./router";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(requestId) });
    }

    try {
      const user = await authenticate(request, env.DB);
      if (!user) {
        return json(401, { error: "unauthorized", requestId }, requestId);
      }
      scheduleLastUsedUpdate(env.DB, ctx, user, requestId);
      return await routeRequest({ request, env, user, requestId });
    } catch (error) {
      logRequestError(request, requestId, error);
      return json(500, { error: "internal error", requestId }, requestId);
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
