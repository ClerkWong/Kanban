import { json } from "./http";
import { handleAttachmentRequest } from "./attachments";
import { handleBoardRequest } from "./boards";
import { handleCalendarRequest } from "./calendar";
import { handleMemberBoardsRequest } from "./member-boards";
import { handleMembershipRequest } from "./memberships";
import { handleLogRequest } from "./logs";
import { handleProjectRequest, type ApiContext } from "./projects";
import { handleReportRequest } from "./reports";
import { AuthorizationError } from "./authorization";
import { RequestError } from "./validation";
import { handleAuthenticatedAuthRequest } from "./auth-routes";
import { handleUserRequest } from "./users";

type RouteContext = ApiContext;

type Route = {
  capability: "authenticated";
  handle(context: RouteContext): Promise<Response | null>;
};
const ROUTES: readonly Route[] = [
  { capability: "authenticated", handle: handleAuthenticatedAuthRequest },
  { capability: "authenticated", handle: handleUserRequest },
  { capability: "authenticated", handle: handleCalendarRequest },
  // handleMemberBoardsRequest 必須排在 handleMembershipRequest 之前：即使目前
  // membership 的 regex 有 `$` 錨定不會誤吃 `/boards` 後綴，這個順序仍是防止未來
  // membership regex 變動時吃掉本路徑的第一道防線。
  { capability: "authenticated", handle: handleMemberBoardsRequest },
  { capability: "authenticated", handle: handleMembershipRequest },
  { capability: "authenticated", handle: handleBoardRequest },
  { capability: "authenticated", handle: handleReportRequest },
  { capability: "authenticated", handle: handleLogRequest },
  { capability: "authenticated", handle: handleAttachmentRequest },
  { capability: "authenticated", handle: handleProjectRequest },
];

export async function routeRequest(context: RouteContext): Promise<Response> {
  try {
    for (const route of ROUTES) {
      const response = await route.handle(context);
      if (response) return response;
    }
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof RequestError) {
      return json(error.status, {
        error: error.code,
        requestId: context.requestId,
      }, context.requestId);
    }
    throw error;
  }
  return json(404, { error: "not found", requestId: context.requestId }, context.requestId);
}
