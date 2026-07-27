"use client";

import { serializeBoard, type AttachmentRef, type BoardState } from "../board-model";
import { usePlatform } from "../platform/context";
import { ApiClientError } from "../projects/api";
import { cacheDownloadedAttachment } from "./attachment-api";
import { fetchRuntimeSession, type RuntimeSession } from "../projects/session";
import {
  saveBoardRevision,
  type StorageLike,
} from "../projects/storage";
import type { BoardContext } from "../projects/types";
import { fetchRemoteBoard, pushRemoteBoard } from "./api";
import {
  enqueueDelete,
  enqueueUpload,
  hasLegacyQueueBlocker,
  pendingUploads,
  processQueue,
  resumeBlockedQueue,
  type AttachmentQueueScope,
} from "./attachment-queue";
import {
  loadBoardRevisionWithLegacyMigration,
  loadSyncConfig,
  type SyncConfig,
} from "./config";
import { mergeBoards } from "./merge";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";

export type BoardSyncStatus =
  | "disabled"
  | "pending"
  | "syncing"
  | "synced"
  | "error";

export type BoardSyncHandle = {
  status: BoardSyncStatus;
  errorMessage: string;
  configured: boolean;
  session: RuntimeSession | null;
  syncNow: () => void;
  queueUploads: (attachments: AttachmentRef[]) => void;
  queueDeletes: (attachments: AttachmentRef[]) => void;
};

export type BoardSyncIdentity = {
  baseUrl: string | null;
  token: string | null;
  userId: string | null;
  context: BoardContext;
};

const DEBOUNCE_MS = 2000;
const MAX_CONFLICT_ROUNDS = 3;

function sameIdentity(
  left: BoardSyncIdentity | null,
  right: BoardSyncIdentity,
): boolean {
  return (
    left?.baseUrl === right.baseUrl &&
    left.token === right.token &&
    left.userId === right.userId &&
    left.context.workspaceId === right.context.workspaceId &&
    left.context.projectId === right.context.projectId &&
    left.context.boardId === right.context.boardId
  );
}

/** In-memory only. Token values are never persisted in a sync generation key. */
export class BoardSyncGuard {
  private identity: BoardSyncIdentity | null = null;
  private generation = 0;

  activate(identity: BoardSyncIdentity): number {
    if (!sameIdentity(this.identity, identity)) {
      this.identity = {
        ...identity,
        context: { ...identity.context },
      };
      this.generation += 1;
    }
    return this.generation;
  }

  isCurrent(identity: BoardSyncIdentity, generation: number): boolean {
    return generation === this.generation && sameIdentity(this.identity, identity);
  }

  invalidate(): void {
    this.identity = null;
    this.generation += 1;
  }
}

function localStorage(): StorageLike {
  if (typeof window === "undefined") {
    throw new Error("Board sync 只能在瀏覽器環境使用。");
  }
  return window.localStorage;
}

function queueScope(
  config: SyncConfig | null,
  session: RuntimeSession | null,
  context: BoardContext,
): AttachmentQueueScope | null {
  return config && session
    ? { config, userId: session.user.id, context }
    : null;
}

function scopeKey(scope: AttachmentQueueScope): string {
  return [
    scope.config.baseUrl,
    scope.config.token,
    scope.userId,
    scope.context.workspaceId,
    scope.context.projectId,
    scope.context.boardId,
  ].join("\n");
}

function remoteStopMessage(error: ApiClientError): string | null {
  if (error.kind === "resource_archived") {
    return "專案或看板已封存；本機待同步資料已保留，不會自動重試。";
  }
  if (error.status === 403) {
    return "目前帳號沒有修改此看板的權限；本機待同步資料已保留。";
  }
  if (error.status === 404) {
    return "找不到看板或目前帳號已不再參與專案；本機待同步資料已保留。";
  }
  if (error.status === 401) {
    return "同步憑證無效；本機待同步資料已保留，請重新設定 token。";
  }
  return null;
}

export function useBoardSync(
  context: BoardContext,
  board: BoardState,
  setBoard: Dispatch<SetStateAction<BoardState>>,
  loaded: boolean,
  readOnly = false,
): BoardSyncHandle {
  const platform = usePlatform();
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const [status, setStatus] = useState<BoardSyncStatus>("disabled");
  const [errorMessage, setErrorMessage] = useState("");
  const boardRef = useRef(board);
  const mountedRef = useRef(true);
  const connectionStartedRef = useRef(false);
  const connectionAttemptRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRef = useRef(new BoardSyncGuard());
  const inFlightRef = useRef(new Set<string>());
  const queuedRef = useRef(new Set<string>());
  const runSyncRef = useRef<(manual?: boolean) => void>(() => {});

  const stableContext = useMemo<BoardContext>(() => ({
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    boardId: context.boardId,
  }), [context.boardId, context.projectId, context.workspaceId]);
  const identity = useMemo<BoardSyncIdentity>(() => ({
    baseUrl: config?.baseUrl ?? null,
    token: config?.token ?? null,
    userId: session?.user.id ?? null,
    context: stableContext,
  }), [
    config?.baseUrl,
    config?.token,
    session?.user.id,
    stableContext,
  ]);
  const activeScope = useMemo(
    () => queueScope(config, session, stableContext),
    [config, session, stableContext],
  );

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    guardRef.current.activate(identity);
  }, [identity]);

  const scheduleRetry = useCallback(
    (nextRetryAt: number | null) => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (nextRetryAt === null) return;
      retryTimerRef.current = setTimeout(
        () => runSyncRef.current(false),
        Math.max(0, nextRetryAt - Date.now()),
      );
    },
    [],
  );

  const cacheMissingAttachments = useCallback(
    async (
      scope: AttachmentQueueScope,
      nextBoard: BoardState,
      canWrite: () => boolean,
    ) => {
      await Promise.all(
        Object.values(nextBoard.cards)
          .flatMap((card) => card.attachments)
          .map(async (attachment) => {
            if (await platform.attachments.exists(attachment.fileName)) return;
            try {
              await cacheDownloadedAttachment(
                scope.config,
                scope.context,
                attachment.id,
                platform,
                attachment.fileName,
                attachment.mimeType,
                canWrite,
              );
            } catch {
              // The attachment UI keeps a visible retry state for failed downloads.
            }
          }),
      );
    },
    [platform],
  );

  const runSync = useCallback(
    async (manual = false) => {
      const scope = activeScope;
      if (!scope || !loaded) return;
      const capturedIdentity = identity;
      const capturedGeneration = guardRef.current.activate(capturedIdentity);
      const canWrite = () =>
        mountedRef.current &&
        guardRef.current.isCurrent(capturedIdentity, capturedGeneration);
      const applyBoard = (nextBoard: BoardState) => {
        if (serializeBoard(boardRef.current) !== serializeBoard(nextBoard)) {
          setBoard(nextBoard);
        }
        boardRef.current = nextBoard;
      };
      const key = scopeKey(scope);
      if (inFlightRef.current.has(key)) {
        queuedRef.current.add(key);
        return;
      }
      queuedRef.current.delete(key);
      inFlightRef.current.add(key);
      if (manual) resumeBlockedQueue(scope);
      if (canWrite()) {
        setStatus("syncing");
        setErrorMessage("");
      }

      try {
        if (hasLegacyQueueBlocker()) {
          throw new Error(
            "偵測到無法判定所屬看板的舊附件佇列；請先完成附件 migration。",
          );
        }

        const storage = localStorage();
        // This is the only v1 revision read. It immediately moves the value to
        // this Board's v2 key and deletes the global key.
        loadBoardRevisionWithLegacyMigration(storage, scope.context.boardId);

        if (readOnly) {
          const remote = await fetchRemoteBoard(scope.config, scope.context);
          if (!canWrite()) return;
          applyBoard(remote.board);
          saveBoardRevision(storage, scope.context.boardId, remote.revision);
          await cacheMissingAttachments(scope, remote.board, canWrite);
          if (canWrite()) setStatus("synced");
          return;
        }

        const beforeUploads = boardRef.current;
        const uploads = await processQueue(
          scope,
          platform,
          Date.now(),
          ["upload"],
        );
        if (!canWrite()) return;
        scheduleRetry(uploads.nextRetryAt);
        const waitingUploads = pendingUploads(
          scope,
          Object.values(beforeUploads.cards)
            .flatMap((card) => card.attachments.map((item) => item.id)),
        );
        if (waitingUploads.length > 0) {
          throw new Error(
            uploads.failure?.message ??
              "附件正在等待上傳完成，完成前不會發布看板引用。",
          );
        }

        const remote = await fetchRemoteBoard(scope.config, scope.context);
        if (!canWrite()) return;

        // Changes made while the GET was in flight have not gone through the
        // upload gate. Merge them locally, then let the queued pass upload and
        // publish them safely.
        if (serializeBoard(boardRef.current) !== serializeBoard(beforeUploads)) {
          const mergedCurrent = mergeBoards(boardRef.current, remote.board);
          applyBoard(mergedCurrent);
          saveBoardRevision(storage, scope.context.boardId, remote.revision);
          queuedRef.current.add(key);
          setStatus("pending");
          return;
        }

        let candidate = mergeBoards(beforeUploads, remote.board);
        applyBoard(candidate);
        await cacheMissingAttachments(scope, candidate, canWrite);
        if (!canWrite()) return;

        if (serializeBoard(candidate) === serializeBoard(remote.board)) {
          saveBoardRevision(storage, scope.context.boardId, remote.revision);
        } else {
          let baseRevision = remote.revision;
          let pushed = false;
          for (let round = 0; round <= MAX_CONFLICT_ROUNDS; round += 1) {
            const result = await pushRemoteBoard(
              scope.config,
              scope.context,
              baseRevision,
              candidate,
            );
            if (!canWrite()) return;
            if (result.kind === "ok") {
              saveBoardRevision(storage, scope.context.boardId, result.revision);
              pushed = true;
              break;
            }

            // Do not publish edits that appeared during this PUT: their
            // attachments have not passed the upload gate yet.
            if (serializeBoard(boardRef.current) !== serializeBoard(candidate)) {
              const mergedCurrent = mergeBoards(boardRef.current, result.board);
              applyBoard(mergedCurrent);
              saveBoardRevision(storage, scope.context.boardId, result.revision);
              queuedRef.current.add(key);
              setStatus("pending");
              return;
            }

            candidate = mergeBoards(candidate, result.board);
            applyBoard(candidate);
            baseRevision = result.revision;
          }
          if (!pushed) {
            throw new Error("同步衝突重試次數過多，請稍後再試。");
          }
        }

        if (!canWrite()) return;
        const referenced = new Set(
          Object.values(boardRef.current.cards)
            .flatMap((card) => card.attachments.map((item) => item.id)),
        );
        const deletes = await processQueue(
          scope,
          platform,
          Date.now(),
          ["delete"],
          referenced,
        );
        if (!canWrite()) return;
        scheduleRetry(deletes.nextRetryAt);
        if (
          deletes.failure &&
          deletes.failure.kind !== "temporary"
        ) {
          setStatus("error");
          setErrorMessage(deletes.failure.message);
          return;
        }
        setStatus("synced");
      } catch (error) {
        if (!canWrite()) return;
        setStatus("error");
        const stopped =
          error instanceof ApiClientError ? remoteStopMessage(error) : null;
        setErrorMessage(
          stopped ??
            (error instanceof Error
              ? error.message
              : "無法連線到同步伺服器；離線變更會保留在本機。"),
        );
      } finally {
        inFlightRef.current.delete(key);
        if (queuedRef.current.delete(key) && canWrite()) {
          queueMicrotask(() => runSyncRef.current(false));
        }
      }
    },
    [
      activeScope,
      cacheMissingAttachments,
      identity,
      loaded,
      platform,
      readOnly,
      scheduleRetry,
      setBoard,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;
    const guard = guardRef.current;
    return () => {
      mountedRef.current = false;
      guard.invalidate();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!loaded || connectionStartedRef.current) return;
    connectionStartedRef.current = true;
    queueMicrotask(() => {
      if (!mountedRef.current) return;
      const stored = loadSyncConfig();
      if (!stored) {
        setStatus("disabled");
        return;
      }
      const attempt = ++connectionAttemptRef.current;
      setConfig(stored);
      setStatus("syncing");
      void fetchRuntimeSession(stored)
        .then((nextSession) => {
          if (!mountedRef.current || connectionAttemptRef.current !== attempt) return;
          setSession(nextSession);
        })
        .catch((error: unknown) => {
          if (!mountedRef.current || connectionAttemptRef.current !== attempt) return;
          setStatus("error");
          setErrorMessage(
            error instanceof ApiClientError && error.status === 401
              ? "同步憑證無效，請重新設定 token。"
              : "無法建立同步 session；本機看板資料不受影響。",
          );
        });
    });
  }, [loaded]);

  useEffect(() => {
    runSyncRef.current = (manual = false) => {
      void runSync(manual);
    };
  }, [runSync]);

  useEffect(() => {
    if (!activeScope || !loaded) return;
    queueMicrotask(() => runSyncRef.current(false));
  }, [activeScope, loaded, runSync]);

  useEffect(() => {
    if (!activeScope || !loaded) return;
    queueMicrotask(() => {
      if (mountedRef.current) {
        setStatus((current) => current === "syncing" ? current : "pending");
      }
    });
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(
      () => runSyncRef.current(false),
      DEBOUNCE_MS,
    );
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [activeScope, board, loaded]);

  useEffect(() => {
    if (!activeScope) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") runSyncRef.current(false);
    };
    const onOnline = () => runSyncRef.current(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [activeScope]);

  const queueUploads = useCallback((attachments: AttachmentRef[]) => {
    if (!activeScope) return;
    for (const attachment of attachments) enqueueUpload(activeScope, attachment);
  }, [activeScope]);

  const queueDeletes = useCallback((attachments: AttachmentRef[]) => {
    if (!activeScope) return;
    for (const attachment of attachments) enqueueDelete(activeScope, attachment);
  }, [activeScope]);

  return {
    status,
    errorMessage,
    configured: config !== null,
    session,
    syncNow: () => runSyncRef.current(true),
    queueUploads,
    queueDeletes,
  };
}
