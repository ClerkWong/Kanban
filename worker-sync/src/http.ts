export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, ETag, X-Request-Id",
  "Access-Control-Max-Age": "86400",
};

export function responseHeaders(requestId: string, init?: HeadersInit): Headers {
  const headers = new Headers(CORS_HEADERS);
  headers.set("X-Request-Id", requestId);
  if (init) {
    for (const [name, value] of new Headers(init)) headers.set(name, value);
  }
  return headers;
}

export function json(
  status: number,
  body: Record<string, unknown>,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(requestId, { "Content-Type": "application/json" }),
  });
}

export function logRequestError(request: Request, requestId: string, error: unknown): void {
  console.error(JSON.stringify({
    event: "request_error",
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    message: error instanceof Error ? error.message : String(error),
  }));
}
