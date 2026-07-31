import type { PlatformCapabilities } from "../platform/types";
import { ApiClientError, apiErrorFromResponse, apiPath, apiUrl, readResponseJson } from "../projects/api";
import { isServerResourceId } from "../projects/model";
import type { BoardContext } from "../projects/types";
import type { SyncConfig } from "./config";

export class AttachmentApiError extends ApiClientError {
  constructor(status: number, message: string) {
    super(
      status,
      status === 401 ? "unauthorized" : status === 404 ? "not_found" : "server_error",
      `http_${status}`,
      message,
    );
    this.name = "AttachmentApiError";
  }
}

function authHeaders(config: SyncConfig): HeadersInit {
  return { Authorization: `Bearer ${config.token}` };
}

function scopedAttachmentPath(context: BoardContext, attachmentId: string): string {
  if (
    !isServerResourceId(context.workspaceId) ||
    !isServerResourceId(context.projectId) ||
    !isServerResourceId(context.boardId)
  ) {
    throw new ApiClientError(
      400,
      "server_error",
      "invalid_board_context",
      "附件操作需要有效的 BoardContext。",
    );
  }
  if (
    !attachmentId ||
    attachmentId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(attachmentId)
  ) {
    throw new ApiClientError(
      400,
      "server_error",
      "invalid_attachment_id",
      "attachmentId 格式不正確。",
    );
  }
  return apiPath(
    "projects",
    context.projectId,
    "boards",
    context.boardId,
    "attachments",
    attachmentId,
  );
}

async function throwAttachmentError(
  response: Response,
  operation: string,
): Promise<never> {
  throw apiErrorFromResponse(response, await readResponseJson(response), operation);
}

export async function uploadAttachment(
  config: SyncConfig,
  context: BoardContext,
  attachmentId: string,
  body: Blob | ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const response = await fetch(
    apiUrl(config, scopedAttachmentPath(context, attachmentId)),
    {
      method: "PUT",
      headers: {
        ...authHeaders(config),
        "Content-Type": mimeType,
      },
      body,
    },
  );
  if (!response.ok) await throwAttachmentError(response, "上傳附件");
}

export async function downloadAttachment(
  config: SyncConfig,
  context: BoardContext,
  attachmentId: string,
): Promise<Blob> {
  const response = await fetch(
    apiUrl(config, scopedAttachmentPath(context, attachmentId)),
    { method: "GET", headers: authHeaders(config) },
  );
  if (!response.ok) await throwAttachmentError(response, "下載附件");
  return response.blob();
}

/** Downloading deliberately writes only local storage; it never creates an upload queue item. */
export async function cacheDownloadedAttachment(
  config: SyncConfig,
  context: BoardContext,
  attachmentId: string,
  platform: PlatformCapabilities,
  fileName: string,
  mimeType: string,
  canWrite: () => boolean | Promise<boolean> = () => true,
): Promise<boolean> {
  const blob = await downloadAttachment(config, context, attachmentId);
  if (!(await canWrite())) return false;
  await platform.attachments.write(fileName, blob, mimeType);
  return true;
}

export async function deleteRemoteAttachment(
  config: SyncConfig,
  context: BoardContext,
  attachmentId: string,
): Promise<void> {
  const response = await fetch(
    apiUrl(config, scopedAttachmentPath(context, attachmentId)),
    { method: "DELETE", headers: authHeaders(config) },
  );
  if (!response.ok) await throwAttachmentError(response, "刪除附件");
}

function legacyUrl(config: SyncConfig, fileName: string): string {
  return `${config.baseUrl}/attachments/${encodeURIComponent(fileName)}`;
}

/** Compatibility-only single-board API. Task 10 replaces the v1 queue. */
export async function uploadLegacyAttachment(
  config: SyncConfig,
  fileName: string,
  body: Blob | ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const response = await fetch(legacyUrl(config, fileName), {
    method: "PUT",
    headers: { ...authHeaders(config), "Content-Type": mimeType },
    body,
  });
  if (!response.ok) {
    throw new AttachmentApiError(response.status, `上傳附件失敗（${response.status}）`);
  }
}

/** Compatibility-only single-board API. Task 10 replaces the v1 queue. */
export async function downloadLegacyAttachment(
  config: SyncConfig,
  fileName: string,
): Promise<Blob> {
  const response = await fetch(legacyUrl(config, fileName), {
    method: "GET",
    headers: authHeaders(config),
  });
  if (!response.ok) {
    throw new AttachmentApiError(response.status, `下載附件失敗（${response.status}）`);
  }
  return response.blob();
}

/** Compatibility-only single-board API. Task 10 replaces this call site. */
export async function cacheLegacyDownloadedAttachment(
  config: SyncConfig,
  platform: PlatformCapabilities,
  fileName: string,
  mimeType: string,
  canWrite: () => boolean | Promise<boolean> = () => true,
): Promise<boolean> {
  const blob = await downloadLegacyAttachment(config, fileName);
  if (!(await canWrite())) return false;
  await platform.attachments.write(fileName, blob, mimeType);
  return true;
}

/** Compatibility-only single-board API. Task 10 replaces the v1 queue. */
export async function deleteLegacyRemoteAttachment(
  config: SyncConfig,
  fileName: string,
): Promise<void> {
  const response = await fetch(legacyUrl(config, fileName), {
    method: "DELETE",
    headers: authHeaders(config),
  });
  if (!response.ok && response.status !== 404) {
    throw new AttachmentApiError(response.status, `刪除附件失敗（${response.status}）`);
  }
}
