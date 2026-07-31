import type { AttachmentRef } from "../board-model";
import type { PlatformCapabilities } from "../platform/types";
import { ATTACHMENT_QUEUE_KEY_V2 } from "../projects/storage";
import { ApiClientError } from "../projects/api";
import { isServerResourceId } from "../projects/model";
import type { BoardContext } from "../projects/types";
import { normalizeBaseUrl, type SyncConfig } from "./config";
import { deleteRemoteAttachment, uploadAttachment } from "./attachment-api";

const LEGACY_QUEUE_KEY = "kanban-attachment-queue-v1";
const MAX_RETRY_DELAY_MS = 60_000;
const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const processingItems = new Set<string>();

class LocalAttachmentMissingError extends Error {
  constructor() {
    super("找不到待上傳的本機附件。");
    this.name = "LocalAttachmentMissingError";
  }
}

export type QueueOperation = "upload" | "delete";

export type AttachmentQueueScope = {
  config: SyncConfig;
  userId: string;
  context: BoardContext;
};

export type QueueItem = {
  endpoint: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  operation: QueueOperation;
  retryCount: number;
  nextRetryAt: number;
  terminal?: "too-large" | "remote-blocked";
};

export type QueueFailure = {
  attachmentId: string | null;
  fileName: string | null;
  operation: QueueOperation | null;
  kind:
    | "migration-blocker"
    | "missing-local"
    | "unauthorized"
    | "too-large"
    | "forbidden"
    | "not-found"
    | "archived"
    | "temporary";
  message: string;
};

export type QueueProcessResult = {
  processed: number;
  nextRetryAt: number | null;
  failure: QueueFailure | null;
};

type LegacyQueueItem = {
  endpoint: string;
  type: QueueOperation;
  fileName: string;
  mimeType: string;
  retryCount: number;
  nextRetryAt: number;
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

function isValidAttachmentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    SAFE_ATTACHMENT_ID.test(value)
  );
}

function validItem(value: unknown): value is QueueItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Partial<QueueItem>;
  return (
    (item.operation === "upload" || item.operation === "delete") &&
    typeof item.endpoint === "string" &&
    isValidEndpoint(item.endpoint) &&
    isServerResourceId(item.userId) &&
    isServerResourceId(item.workspaceId) &&
    isServerResourceId(item.projectId) &&
    isServerResourceId(item.boardId) &&
    isValidAttachmentId(item.attachmentId) &&
    typeof item.fileName === "string" &&
    item.fileName.length > 0 &&
    typeof item.mimeType === "string" &&
    typeof item.retryCount === "number" &&
    Number.isInteger(item.retryCount) &&
    item.retryCount >= 0 &&
    typeof item.nextRetryAt === "number" &&
    Number.isFinite(item.nextRetryAt) &&
    item.nextRetryAt >= 0 &&
    (
      item.terminal === undefined ||
      item.terminal === "too-large" ||
      item.terminal === "remote-blocked"
    )
  );
}

function assertScope(scope: AttachmentQueueScope): void {
  endpointIdentity(scope.config);
  if (
    !isServerResourceId(scope.userId) ||
    !isServerResourceId(scope.context.workspaceId) ||
    !isServerResourceId(scope.context.projectId) ||
    !isServerResourceId(scope.context.boardId)
  ) {
    throw new Error("Attachment queue scope 必須包含有效的 user 與 BoardContext UUID。");
  }
}

function scopeMatches(item: QueueItem, scope: AttachmentQueueScope): boolean {
  return (
    item.endpoint === endpointIdentity(scope.config) &&
    item.userId === scope.userId &&
    item.workspaceId === scope.context.workspaceId &&
    item.projectId === scope.context.projectId &&
    item.boardId === scope.context.boardId
  );
}

function itemKey(item: QueueItem): string {
  return [
    item.endpoint,
    item.userId,
    item.workspaceId,
    item.projectId,
    item.boardId,
    item.attachmentId,
    item.operation,
  ].join("\n");
}

export function loadQueue(): QueueItem[] {
  try {
    const raw = window.localStorage.getItem(ATTACHMENT_QUEUE_KEY_V2);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(validItem) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueueItem[]): void {
  if (!queue.every(validItem)) {
    throw new Error("Attachment queue v2 含有無效項目。");
  }
  if (queue.length === 0) {
    window.localStorage.removeItem(ATTACHMENT_QUEUE_KEY_V2);
  } else {
    window.localStorage.setItem(ATTACHMENT_QUEUE_KEY_V2, JSON.stringify(queue));
  }
}

function newItem(
  scope: AttachmentQueueScope,
  operation: QueueOperation,
  attachment: Pick<AttachmentRef, "id" | "fileName" | "mimeType">,
): QueueItem {
  assertScope(scope);
  if (!isValidAttachmentId(attachment.id) || !attachment.fileName) {
    throw new Error("Attachment queue item 缺少有效的 attachmentId 或 fileName。");
  }
  return {
    endpoint: endpointIdentity(scope.config),
    userId: scope.userId,
    workspaceId: scope.context.workspaceId,
    projectId: scope.context.projectId,
    boardId: scope.context.boardId,
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    operation,
    retryCount: 0,
    nextRetryAt: 0,
  };
}

export function enqueueUpload(
  scope: AttachmentQueueScope,
  attachment: Pick<AttachmentRef, "id" | "fileName" | "mimeType">,
): void {
  const queue = loadQueue();
  if (
    queue.some((item) =>
      scopeMatches(item, scope) &&
      item.attachmentId === attachment.id &&
      item.operation === "upload"
    )
  ) {
    return;
  }
  const filtered = queue.filter((item) =>
    !(
      scopeMatches(item, scope) &&
      item.attachmentId === attachment.id &&
      item.operation === "delete"
    )
  );
  filtered.push(newItem(scope, "upload", attachment));
  saveQueue(filtered);
}

export function enqueueDelete(
  scope: AttachmentQueueScope,
  attachment: Pick<AttachmentRef, "id" | "fileName" | "mimeType">,
): void {
  const queue = loadQueue();
  const filtered = queue.filter((item) =>
    !(scopeMatches(item, scope) && item.attachmentId === attachment.id)
  );
  // DELETE is idempotent. Always enqueue it even if an upload was pending:
  // the upload may already have reached R2 before a crash prevented persistence.
  filtered.push(newItem(scope, "delete", attachment));
  saveQueue(filtered);
}

function loadLegacyQueue(): LegacyQueueItem[] | null {
  const raw = window.localStorage.getItem(LEGACY_QUEUE_KEY);
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const queue = value.filter((item): item is LegacyQueueItem => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Partial<LegacyQueueItem>;
      return (
        (row.type === "upload" || row.type === "delete") &&
        typeof row.endpoint === "string" &&
        typeof row.fileName === "string" &&
        typeof row.mimeType === "string" &&
        typeof row.retryCount === "number" &&
        typeof row.nextRetryAt === "number"
      );
    });
    return queue.length === value.length ? queue : null;
  } catch {
    return null;
  }
}

export function hasLegacyQueueBlocker(): boolean {
  const queue = loadLegacyQueue();
  return queue === null || queue.length > 0;
}

function saveLegacyQueue(queue: LegacyQueueItem[]): void {
  if (queue.length === 0) {
    window.localStorage.removeItem(LEGACY_QUEUE_KEY);
  } else {
    window.localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(queue));
  }
}

/** Compatibility-only: v1 has no user/Project/Board/attachment IDs, so it is
 * intentionally parked until Task 13 can migrate it with an explicit target. */
export function enqueueLegacyUpload(
  config: SyncConfig,
  fileName: string,
  mimeType: string,
): void {
  const endpoint = endpointIdentity(config);
  const queue = loadLegacyQueue() ?? [];
  if (
    queue.some((item) =>
      item.endpoint === endpoint &&
      item.fileName === fileName &&
      item.type === "upload"
    )
  ) {
    return;
  }
  const filtered = queue.filter((item) =>
    !(item.endpoint === endpoint && item.fileName === fileName && item.type === "delete")
  );
  filtered.push({
    endpoint,
    type: "upload",
    fileName,
    mimeType,
    retryCount: 0,
    nextRetryAt: 0,
  });
  saveLegacyQueue(filtered);
}

/** Compatibility-only counterpart to enqueueLegacyUpload. */
export function enqueueLegacyDelete(config: SyncConfig, fileName: string): void {
  const endpoint = endpointIdentity(config);
  const queue = loadLegacyQueue() ?? [];
  const filtered = queue.filter((item) =>
    !(item.endpoint === endpoint && item.fileName === fileName)
  );
  filtered.push({
    endpoint,
    type: "delete",
    fileName,
    mimeType: "",
    retryCount: 0,
    nextRetryAt: 0,
  });
  saveLegacyQueue(filtered);
}

async function readLocalBlob(
  platform: PlatformCapabilities,
  fileName: string,
  mimeType: string,
): Promise<Blob> {
  const url = await platform.attachments.loadAsUrl(fileName, mimeType);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("本機附件讀取失敗。");
    return await response.blob();
  } finally {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

export function retryDelay(retryCount: number): number {
  return Math.min(1000 * 2 ** Math.max(0, retryCount), MAX_RETRY_DELAY_MS);
}

function failureFor(error: unknown, item: QueueItem): QueueFailure {
  const base = {
    attachmentId: item.attachmentId,
    fileName: item.fileName,
    operation: item.operation,
  };
  if (error instanceof LocalAttachmentMissingError) {
    return { ...base, kind: "missing-local", message: error.message };
  }
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return { ...base, kind: "unauthorized", message: "附件同步憑證無效。" };
    }
    if (error.status === 413) {
      return { ...base, kind: "too-large", message: "附件超過伺服器的 10 MB 限制。" };
    }
    if (error.kind === "resource_archived") {
      return { ...base, kind: "archived", message: "專案或看板已封存，附件變更保留在本機。" };
    }
    if (error.status === 403) {
      return { ...base, kind: "forbidden", message: "目前帳號沒有修改此看板附件的權限。" };
    }
    if (error.status === 404) {
      return { ...base, kind: "not-found", message: "看板不存在或目前帳號已不再參與專案。" };
    }
  }
  return {
    ...base,
    kind: "temporary",
    message: "附件同步暫時失敗，將自動重試。",
  };
}

function resultFor(
  queue: QueueItem[],
  scope: AttachmentQueueScope,
  processed: number,
  failure: QueueFailure | null,
): QueueProcessResult {
  const times = queue
    .filter((item) => scopeMatches(item, scope) && item.nextRetryAt > 0)
    .map((item) => item.nextRetryAt);
  return {
    processed,
    nextRetryAt: times.length ? Math.min(...times) : null,
    failure,
  };
}

export async function processQueue(
  scope: AttachmentQueueScope,
  platform: PlatformCapabilities,
  now = Date.now(),
  operations: readonly QueueOperation[] = ["upload", "delete"],
  excludedAttachmentIds?: ReadonlySet<string>,
): Promise<QueueProcessResult> {
  assertScope(scope);
  if (hasLegacyQueueBlocker()) {
    return {
      processed: 0,
      nextRetryAt: null,
      failure: {
        attachmentId: null,
        fileName: null,
        operation: null,
        kind: "migration-blocker",
        message: "偵測到無法判定所屬看板的舊附件佇列；請先完成附件 migration。",
      },
    };
  }

  let processed = 0;
  let failure: QueueFailure | null = null;

  for (const item of loadQueue()) {
    if (
      !scopeMatches(item, scope) ||
      item.nextRetryAt > now ||
      !operations.includes(item.operation) ||
      excludedAttachmentIds?.has(item.attachmentId)
    ) {
      continue;
    }
    const key = itemKey(item);
    if (processingItems.has(key)) continue;
    if (item.terminal) {
      failure = item.terminal === "too-large"
        ? {
          attachmentId: item.attachmentId,
          fileName: item.fileName,
          operation: item.operation,
          kind: "too-large",
          message: "附件超過伺服器的 10 MB 限制。",
        }
        : {
          attachmentId: item.attachmentId,
          fileName: item.fileName,
          operation: item.operation,
          kind: "forbidden",
          message: "遠端目前不允許此附件操作；變更已保留在本機。",
        };
      continue;
    }
    processingItems.add(key);
    try {
      if (item.operation === "upload") {
        if (!(await platform.attachments.exists(item.fileName))) {
          throw new LocalAttachmentMissingError();
        }
        const blob = await readLocalBlob(platform, item.fileName, item.mimeType);
        await uploadAttachment(
          scope.config,
          scope.context,
          item.attachmentId,
          blob,
          item.mimeType,
        );
      } else {
        await deleteRemoteAttachment(scope.config, scope.context, item.attachmentId);
      }
      const latest = loadQueue().filter((candidate) => itemKey(candidate) !== key);
      saveQueue(latest);
      processed += 1;
    } catch (error) {
      const nextFailure = failureFor(error, item);
      failure = nextFailure;
      const latest = loadQueue();
      const current = latest.find((candidate) => itemKey(candidate) === key);
      if (!current) continue;
      if (nextFailure.kind === "too-large") {
        current.terminal = "too-large";
        current.nextRetryAt = 0;
        saveQueue(latest);
        continue;
      }
      if (
        nextFailure.kind === "unauthorized" ||
        nextFailure.kind === "forbidden" ||
        nextFailure.kind === "not-found" ||
        nextFailure.kind === "archived"
      ) {
        current.terminal = "remote-blocked";
        current.nextRetryAt = 0;
        saveQueue(latest);
        continue;
      }
      current.retryCount += 1;
      current.nextRetryAt = now + retryDelay(current.retryCount);
      saveQueue(latest);
    } finally {
      processingItems.delete(key);
    }
  }

  return resultFor(loadQueue(), scope, processed, failure);
}

/** Manual retry only: automatic timers never clear terminal remote blockers. */
export function resumeBlockedQueue(scope: AttachmentQueueScope): void {
  const queue = loadQueue();
  for (const item of queue) {
    if (scopeMatches(item, scope) && item.terminal === "remote-blocked") {
      delete item.terminal;
      item.nextRetryAt = 0;
    }
  }
  saveQueue(queue);
}

export function pendingUploads(
  scope: AttachmentQueueScope,
  attachmentIds: Iterable<string>,
): QueueItem[] {
  const wanted = new Set(attachmentIds);
  return loadQueue().filter((item) =>
    scopeMatches(item, scope) &&
    item.operation === "upload" &&
    wanted.has(item.attachmentId)
  );
}

/** Only queue files that are actually present on this device. */
export async function enqueueExistingAttachments(
  scope: AttachmentQueueScope,
  platform: PlatformCapabilities,
  cards: Record<string, { attachments: AttachmentRef[] }>,
): Promise<void> {
  for (const card of Object.values(cards)) {
    for (const attachment of card.attachments) {
      if (await platform.attachments.exists(attachment.fileName)) {
        enqueueUpload(scope, attachment);
      }
    }
  }
}
