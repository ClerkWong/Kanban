import type { PlatformCapabilities } from "../platform/types";
import { normalizeBaseUrl, type SyncConfig } from "./config";
import { AttachmentApiError, deleteRemoteAttachment, uploadAttachment } from "./attachment-api";

const QUEUE_KEY = "kanban-attachment-queue-v1";
const MAX_RETRY_DELAY_MS = 60_000;

class LocalAttachmentMissingError extends Error {
  constructor() {
    super("找不到待上傳的本機附件。");
    this.name = "LocalAttachmentMissingError";
  }
}

export type QueueItemType = "upload" | "delete";

export type QueueItem = {
  endpoint: string;
  type: QueueItemType;
  fileName: string;
  mimeType: string;
  retryCount: number;
  nextRetryAt: number;
  terminal?: "too-large";
};

export type QueueFailure = {
  fileName: string;
  type: QueueItemType;
  kind: "missing-local" | "unauthorized" | "too-large" | "not-found" | "temporary";
  message: string;
};

export type QueueProcessResult = {
  processed: number;
  nextRetryAt: number | null;
  failure: QueueFailure | null;
};

export function endpointIdentity(config: Pick<SyncConfig, "baseUrl">): string {
  return normalizeBaseUrl(config.baseUrl);
}

function isValidEndpoint(value: string): boolean {
  try {
    return normalizeBaseUrl(value) === value;
  } catch {
    return false;
  }
}

function validItem(value: unknown): value is QueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<QueueItem>;
  return (
    (item.type === "upload" || item.type === "delete") &&
    typeof item.endpoint === "string" &&
    item.endpoint.length > 0 &&
    isValidEndpoint(item.endpoint) &&
    typeof item.fileName === "string" &&
    item.fileName.length > 0 &&
    typeof item.mimeType === "string" &&
    typeof item.retryCount === "number" &&
    Number.isInteger(item.retryCount) &&
    item.retryCount >= 0 &&
    typeof item.nextRetryAt === "number" &&
    Number.isFinite(item.nextRetryAt) &&
    item.nextRetryAt >= 0 &&
    (item.terminal === undefined || item.terminal === "too-large")
  );
}

export function loadQueue(): QueueItem[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) {
      return [];
    }
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(validItem) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueueItem[]): void {
  if (queue.length === 0) {
    window.localStorage.removeItem(QUEUE_KEY);
  } else {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
}

function newItem(
  config: SyncConfig,
  type: QueueItemType,
  fileName: string,
  mimeType: string,
): QueueItem {
  return {
    endpoint: endpointIdentity(config),
    type,
    fileName,
    mimeType,
    retryCount: 0,
    nextRetryAt: 0,
  };
}

export function enqueueUpload(config: SyncConfig, fileName: string, mimeType: string): void {
  const endpoint = endpointIdentity(config);
  const queue = loadQueue();
  if (queue.some((item) => item.endpoint === endpoint && item.fileName === fileName && item.type === "upload")) {
    return;
  }
  const filtered = queue.filter(
    (item) => !(item.endpoint === endpoint && item.fileName === fileName && item.type === "delete"),
  );
  filtered.push(newItem(config, "upload", fileName, mimeType));
  saveQueue(filtered);
}

export function enqueueDelete(config: SyncConfig, fileName: string): void {
  const endpoint = endpointIdentity(config);
  const queue = loadQueue();
  const filtered = queue.filter(
    (item) =>
      !(
        item.endpoint === endpoint &&
        item.fileName === fileName &&
        (item.type === "upload" || item.type === "delete")
      ),
  );
  // DELETE is idempotent. Always enqueue it even when an upload was pending:
  // the upload may already have reached R2 before a crash prevented queue persistence.
  filtered.push(newItem(config, "delete", fileName, ""));
  saveQueue(filtered);
}

async function readLocalBlob(
  platform: PlatformCapabilities,
  fileName: string,
  mimeType: string,
): Promise<Blob> {
  const url = await platform.attachments.loadAsUrl(fileName, mimeType);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("本機附件讀取失敗。");
    }
    return await response.blob();
  } finally {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

export function retryDelay(retryCount: number): number {
  return Math.min(1000 * 2 ** Math.max(0, retryCount), MAX_RETRY_DELAY_MS);
}

function failureFor(error: unknown, item: QueueItem): QueueFailure {
  if (error instanceof LocalAttachmentMissingError) {
    return { fileName: item.fileName, type: item.type, kind: "missing-local", message: error.message };
  }
  if (error instanceof AttachmentApiError) {
    if (error.status === 401) {
      return { fileName: item.fileName, type: item.type, kind: "unauthorized", message: "附件同步憑證無效。" };
    }
    if (error.status === 413) {
      return { fileName: item.fileName, type: item.type, kind: "too-large", message: "附件超過伺服器的 10 MB 限制。" };
    }
    if (error.status === 404) {
      return { fileName: item.fileName, type: item.type, kind: "not-found", message: "找不到遠端附件。" };
    }
  }
  return { fileName: item.fileName, type: item.type, kind: "temporary", message: "附件同步暫時失敗，將自動重試。" };
}

function resultFor(queue: QueueItem[], endpoint: string, processed: number, failure: QueueFailure | null): QueueProcessResult {
  const times = queue
    .filter((item) => item.endpoint === endpoint && item.nextRetryAt > 0)
    .map((item) => item.nextRetryAt);
  return { processed, nextRetryAt: times.length ? Math.min(...times) : null, failure };
}

export async function processQueue(
  config: SyncConfig,
  platform: PlatformCapabilities,
  now = Date.now(),
  types: readonly QueueItemType[] = ["upload", "delete"],
  excludedFileNames?: ReadonlySet<string>,
): Promise<QueueProcessResult> {
  const endpoint = endpointIdentity(config);
  let queue = loadQueue();
  let processed = 0;
  let failure: QueueFailure | null = null;

  for (const item of [...queue]) {
    if (
      item.endpoint !== endpoint ||
      item.nextRetryAt > now ||
      !types.includes(item.type) ||
      excludedFileNames?.has(item.fileName)
    ) {
      continue;
    }
    if (item.terminal === "too-large") {
      failure = {
        fileName: item.fileName,
        type: item.type,
        kind: "too-large",
        message: "附件超過伺服器的 10 MB 限制。",
      };
      continue;
    }
    try {
      if (item.type === "upload") {
        if (!(await platform.attachments.exists(item.fileName))) {
          throw new LocalAttachmentMissingError();
        }
        const blob = await readLocalBlob(platform, item.fileName, item.mimeType);
        await uploadAttachment(config, item.fileName, blob, item.mimeType);
      } else {
        await deleteRemoteAttachment(config, item.fileName);
      }
      queue = queue.filter((candidate) => candidate !== item);
      processed += 1;
    } catch (error) {
      const nextFailure = failureFor(error, item);
      failure = nextFailure;
      if (nextFailure.kind === "too-large") {
        // Keep the item as a durable blocker: silently dropping it would allow
        // the board to publish an attachment reference that can never resolve.
        item.terminal = "too-large";
        continue;
      }
      item.retryCount += 1;
      item.nextRetryAt = now + retryDelay(item.retryCount);
    }
  }

  saveQueue(queue);
  return resultFor(queue, endpoint, processed, failure);
}

export function pendingUploads(config: SyncConfig, fileNames: Iterable<string>): QueueItem[] {
  const endpoint = endpointIdentity(config);
  const wanted = new Set(fileNames);
  return loadQueue().filter(
    (item) => item.endpoint === endpoint && item.type === "upload" && wanted.has(item.fileName),
  );
}

/** Only queue files that are actually present on this device. */
export async function enqueueExistingAttachments(
  config: SyncConfig,
  platform: PlatformCapabilities,
  cards: Record<string, { attachments: Array<{ fileName: string; mimeType: string }> }>,
): Promise<void> {
  for (const card of Object.values(cards)) {
    for (const attachment of card.attachments) {
      if (await platform.attachments.exists(attachment.fileName)) {
        enqueueUpload(config, attachment.fileName, attachment.mimeType);
      }
    }
  }
}
