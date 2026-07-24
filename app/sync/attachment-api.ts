import type { SyncConfig } from "./config";
import type { PlatformCapabilities } from "../platform/types";

export class AttachmentApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AttachmentApiError";
    this.status = status;
  }
}

function authHeaders(config: SyncConfig): HeadersInit {
  return { Authorization: `Bearer ${config.token}` };
}

export async function uploadAttachment(
  config: SyncConfig,
  fileName: string,
  body: Blob | ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const response = await fetch(`${config.baseUrl}/attachments/${encodeURIComponent(fileName)}`, {
    method: "PUT",
    headers: {
      ...authHeaders(config),
      "Content-Type": mimeType,
    },
    body,
  });
  if (!response.ok) {
    throw new AttachmentApiError(response.status, `上傳附件失敗（${response.status}）`);
  }
}

export async function downloadAttachment(
  config: SyncConfig,
  fileName: string,
): Promise<Blob> {
  const response = await fetch(`${config.baseUrl}/attachments/${encodeURIComponent(fileName)}`, {
    method: "GET",
    headers: authHeaders(config),
  });
  if (!response.ok) {
    throw new AttachmentApiError(response.status, `下載附件失敗（${response.status}）`);
  }
  return response.blob();
}

/** Downloading deliberately writes only local storage; it never creates an upload queue item. */
export async function cacheDownloadedAttachment(
  config: SyncConfig,
  platform: PlatformCapabilities,
  fileName: string,
  mimeType: string,
  canWrite: () => boolean | Promise<boolean> = () => true,
): Promise<boolean> {
  const blob = await downloadAttachment(config, fileName);
  if (!(await canWrite())) {
    return false;
  }
  await platform.attachments.write(fileName, blob, mimeType);
  return true;
}

export async function deleteRemoteAttachment(
  config: SyncConfig,
  fileName: string,
): Promise<void> {
  const response = await fetch(`${config.baseUrl}/attachments/${encodeURIComponent(fileName)}`, {
    method: "DELETE",
    headers: authHeaders(config),
  });
  if (!response.ok && response.status !== 404) {
    throw new AttachmentApiError(response.status, `刪除附件失敗（${response.status}）`);
  }
}
