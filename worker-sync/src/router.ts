import { json } from "./http";
import { handleAttachmentRequest } from "./attachments";
import { handleBoardRequest } from "./boards";
import { handleMembershipRequest } from "./memberships";
import { handleLogRequest } from "./logs";
import { handleProjectRequest, type ApiContext } from "./projects";
import { handleReportRequest } from "./reports";
import { AuthorizationError } from "./authorization";
import { RequestError } from "./validation";

type RouteContext = ApiContext;

type Route = {
  capability: "authenticated";
  handle(context: RouteContext): Promise<Response | null>;
};
const ROUTES: readonly Route[] = [
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
