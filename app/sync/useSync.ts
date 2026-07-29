"use client";

import {
  parsePersistedBoard,
  serializeBoard,
  type AttachmentRef,
  type BoardState,
} from "../board-model";
import { usePlatform } from "../platform/context";
import { ApiClientError } from "../projects/api";
import { LOCAL_LEGACY_BOARD_ID } from "../projects/model";
import { saveBoardRevision } from "../projects/storage";
import { fetchRuntimeSession, type RuntimeSession } from "../projects/session";
import {
  type LegacyPushResult,
  SyncApiError,
  fetchLegacyRemoteBoard,
  pushLegacyRemoteBoard,
} from "./api";
import { downloadLegacyAttachment } from "./attachment-api";
import {
  enqueueLegacyDelete,
  enqueueLegacyUpload,
  hasLegacyQueueBlocker,
} from "./attachment-queue";
import { prepareInitialConnection } from "./initial-connection";
import {
  loadBoardRevisionWithLegacyMigration,
  loadSyncConfig,
  saveSyncConfig,
  type SyncConfig,
} from "./config";
import { mergeBoards } from "./merge";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type SyncStatus = "disabled" | "pending" | "syncing" | "synced" | "error";

export type SyncHandle = {
  status: SyncStatus;
  errorMessage: string;
  configured: boolean;
  session: RuntimeSession | null;
  syncNow: () => void;
  enable: (config: SyncConfig, initialMode: "download" | "merge") => Promise<void>;
  disable: () => void;
  queueUploads: (attachments: AttachmentRef[]) => void;
  queueDeletes: (attachments: AttachmentRef[]) => void;
};

const DEBOUNCE_MS = 2000;
const MAX_CONFLICT_ROUNDS = 3;

function toBoardState(value: unknown): BoardState {
  const parsed = parsePersistedBoard(JSON.stringify(value));
  if (parsed.recovered) {
    throw new SyncApiError(
      422,
      "遠端看板資料格式異常，暫停同步以保護本機資料。",
    );
  }
  return parsed.board;
}

/** Single-board compatibility wrapper retained until Task 11 switches the UI
 * to useBoardStore/useBoardSync. It no longer processes the unscoped v1
 * attachment queue and no longer reads or writes a global sync revision. */
export function useSync(
  board: BoardState,
  setBoard: Dispatch<SetStateAction<BoardState>>,
  loaded: boolean,
): SyncHandle {
  const platform = usePlatform();
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>("disabled");
  const [errorMessage, setErrorMessage] = useState("");
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const boardRef = useRef(board);
  const configRef = useRef<SyncConfig | null>(null);
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSyncRef = useRef<() => void>(() => {});

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const configIsCurrent = useCallback((active: SyncConfig) => {
    const current = configRef.current;
    return current?.baseUrl === active.baseUrl && current.token === active.token;
  }, []);

  const cacheMissingAttachments = useCallback(
    async (active: SyncConfig, nextBoard: BoardState) => {
      await Promise.all(
        Object.values(nextBoard.cards)
          .flatMap((card) => card.attachments)
          .map(async (attachment) => {
            if (await platform.attachments.exists(attachment.fileName)) return;
            try {
              const blob = await downloadLegacyAttachment(active, attachment.fileName);
              if (configIsCurrent(active)) {
                await platform.attachments.write(
                  attachment.fileName,
                  blob,
                  attachment.mimeType,
                );
              }
            } catch {
              // The attachment item offers an explicit retry action.
            }
          }),
      );
    },
    [configIsCurrent, platform],
  );

  const runSync = useCallback(async () => {
    const active = configRef.current;
    if (!active || !loaded) return;
    if (busyRef.current) {
      queuedRef.current = true;
      return;
    }
    busyRef.current = true;
    queuedRef.current = false;
    setStatus("syncing");
    setErrorMessage("");
    try {
      if (hasLegacyQueueBlocker()) {
        throw new SyncApiError(
          409,
          "舊附件佇列無法判定所屬 Project/Board，已停止傳送並保留本機資料。",
        );
      }
      const storage = window.localStorage;
      loadBoardRevisionWithLegacyMigration(storage, LOCAL_LEGACY_BOARD_ID);
      const remote = await fetchLegacyRemoteBoard(active);
      if (!configIsCurrent(active)) return;
      if (!remote) {
        const created = await pushLegacyRemoteBoard(active, 0, boardRef.current);
        if (!configIsCurrent(active)) return;
        if (created.kind === "ok") {
          saveBoardRevision(storage, LOCAL_LEGACY_BOARD_ID, created.revision);
          setStatus("synced");
          return;
        }
      }

      let baseRevision = remote?.revision ?? 0;
      let candidate = remote
        ? mergeBoards(boardRef.current, toBoardState(remote.board))
        : boardRef.current;
      if (serializeBoard(boardRef.current) !== serializeBoard(candidate)) {
        setBoard(candidate);
      }
      boardRef.current = candidate;
      if (remote) await cacheMissingAttachments(active, candidate);

      if (
        remote &&
        serializeBoard(candidate) === serializeBoard(toBoardState(remote.board))
      ) {
        saveBoardRevision(storage, LOCAL_LEGACY_BOARD_ID, remote.revision);
        setStatus("synced");
        return;
      }

      for (let round = 0; round <= MAX_CONFLICT_ROUNDS; round += 1) {
        const result: LegacyPushResult = await pushLegacyRemoteBoard(
          active,
          baseRevision,
          candidate,
        );
        if (!configIsCurrent(active)) return;
        if (result.kind === "ok") {
          saveBoardRevision(storage, LOCAL_LEGACY_BOARD_ID, result.revision);
          setStatus("synced");
          return;
        }
        if (result.board === null) {
          baseRevision = 0;
          continue;
        }
        const remoteBoard = toBoardState(result.board);
        candidate = mergeBoards(boardRef.current, remoteBoard);
        if (serializeBoard(boardRef.current) !== serializeBoard(candidate)) {
          setBoard(candidate);
        }
        boardRef.current = candidate;
        await cacheMissingAttachments(active, candidate);
        baseRevision = result.revision;
      }
      throw new SyncApiError(409, "同步衝突重試次數過多，請稍後再試。");
    } catch (error) {
      if (!configIsCurrent(active)) return;
      setStatus("error");
      setErrorMessage(
        error instanceof SyncApiError
          ? error.message
          : "無法連線到同步伺服器，離線變更會保留在本機。",
      );
    } finally {
      busyRef.current = false;
      if (queuedRef.current && configIsCurrent(active)) {
        queuedRef.current = false;
        queueMicrotask(() => runSyncRef.current());
      }
    }
  }, [cacheMissingAttachments, configIsCurrent, loaded, setBoard]);

  useEffect(() => {
    if (!loaded) return;
    const stored = loadSyncConfig();
    if (!stored) return;
    configRef.current = stored;
    queueMicrotask(() => {
      if (!configIsCurrent(stored)) return;
      setConfig(stored);
      setStatus("syncing");
      void fetchRuntimeSession(stored)
        .then((identity) => {
          if (!configIsCurrent(stored)) return;
          setSession(identity);
          return runSync();
        })
        .catch(() => {
          if (!configIsCurrent(stored)) return;
          setStatus("error");
          setErrorMessage("啟動同步失敗，將於手動重試時再試。");
        });
    });
  }, [configIsCurrent, loaded, runSync]);

  useEffect(() => {
    if (!config || !loaded) return;
    queueMicrotask(() => {
      setStatus((current) => current === "syncing" ? current : "pending");
    });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSyncRef.current(), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [board, config, loaded]);

  useEffect(() => {
    runSyncRef.current = () => {
      void runSync();
    };
  }, [runSync]);

  const enable = useCallback(
    async (next: SyncConfig, initialMode: "download" | "merge") => {
      setSession(null);
      configRef.current = next;
      setStatus("syncing");
      setErrorMessage("");
      try {
        const connection = await prepareInitialConnection(next, {
          isCurrent: () => configIsCurrent(next),
        });
        if (connection.kind === "stale") return;
        const identity = connection.session;
        setConfig(next);
        setSession(identity);
        if (connection.kind === "projects") {
          setStatus("synced");
          window.location.reload();
          return;
        }
        if (initialMode === "merge") {
          for (const attachment of Object.values(boardRef.current.cards)
            .flatMap((card) => card.attachments)) {
            if (await platform.attachments.exists(attachment.fileName)) {
              enqueueLegacyUpload(next, attachment.fileName, attachment.mimeType);
            }
          }
        }
        const remote = connection.remote;
        if (remote) {
          const base =
            initialMode === "download"
              ? toBoardState(remote.board)
              : mergeBoards(boardRef.current, toBoardState(remote.board));
          saveBoardRevision(window.localStorage, LOCAL_LEGACY_BOARD_ID, remote.revision);
          setBoard(base);
          boardRef.current = base;
          await cacheMissingAttachments(next, base);
        } else {
          saveBoardRevision(window.localStorage, LOCAL_LEGACY_BOARD_ID, 0);
        }
        await runSync();
      } catch (error) {
        if (!configIsCurrent(next)) return;
        configRef.current = null;
        setConfig(null);
        setSession(null);
        saveSyncConfig(null);
        setStatus("error");
        setErrorMessage(
          error instanceof ApiClientError && error.status === 401
            ? "token 無效，請確認後重新輸入。"
            : "無法連線到同步伺服器，請確認網址與網路。",
        );
      }
    },
    [cacheMissingAttachments, configIsCurrent, platform, runSync, setBoard],
  );

  const disable = useCallback(() => {
    saveSyncConfig(null);
    setConfig(null);
    setSession(null);
    configRef.current = null;
    setStatus("disabled");
    setErrorMessage("");
  }, []);

  const queueUploads = useCallback((attachments: AttachmentRef[]) => {
    const active = configRef.current;
    if (!active) return;
    for (const attachment of attachments) {
      enqueueLegacyUpload(active, attachment.fileName, attachment.mimeType);
    }
  }, []);

  const queueDeletes = useCallback((attachments: AttachmentRef[]) => {
    const active = configRef.current;
    if (!active) return;
    for (const attachment of attachments) {
      enqueueLegacyDelete(active, attachment.fileName);
    }
  }, []);

  return {
    status,
    errorMessage,
    configured: config !== null,
    session,
    syncNow: () => runSyncRef.current(),
    enable,
    disable,
    queueUploads,
    queueDeletes,
  };
}
