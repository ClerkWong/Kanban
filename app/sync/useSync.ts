"use client";

import { type BoardState, parsePersistedBoard, serializeBoard } from "../board-model";
import { type PushResult, SyncApiError, fetchRemoteBoard, pushRemoteBoard } from "./api";
import {
  type SyncConfig,
  loadSyncConfig,
  loadSyncRevision,
  saveSyncConfig,
  saveSyncRevision,
} from "./config";
import { mergeBoards } from "./merge";
import { downloadAttachment as downloadRemoteAttachment } from "./attachment-api";
import {
  enqueueDelete,
  enqueueExistingAttachments,
  enqueueUpload,
  pendingUploads,
  processQueue,
} from "./attachment-queue";
import { usePlatform } from "../platform/context";
import type { AttachmentRef } from "../board-model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type SyncStatus = "disabled" | "pending" | "syncing" | "synced" | "error";

export type SyncHandle = {
  status: SyncStatus;
  errorMessage: string;
  configured: boolean;
  syncNow: () => void;
  enable: (config: SyncConfig, initialMode: "download" | "merge") => Promise<void>;
  disable: () => void;
  queueUploads: (attachments: AttachmentRef[]) => void;
  queueDeletes: (attachments: AttachmentRef[]) => void;
};

const DEBOUNCE_MS = 2000;
const MAX_CONFLICT_ROUNDS = 3;

function toBoardState(value: unknown): BoardState {
  // 遠端資料視同不可信持久化資料，走同一套防呆解析
  const parsed = parsePersistedBoard(JSON.stringify(value));
  if (parsed.recovered) {
    // 遠端資料格式異常或版本未知：絕不可靜默替換為示範資料再合併回推，
    // 否則會把示範看板推上共用伺服器，污染其他裝置。改丟錯誤讓 runSync 的
    // catch 區塊統一處理為同步失敗狀態。
    throw new SyncApiError(422, "遠端看板資料格式異常，暫停同步以保護本機資料。");
  }
  return parsed.board;
}

export function useSync(
  board: BoardState,
  setBoard: Dispatch<SetStateAction<BoardState>>,
  loaded: boolean,
): SyncHandle {
  const platform = usePlatform();
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>("disabled");
  const [errorMessage, setErrorMessage] = useState("");
  const boardRef = useRef(board);
  const configRef = useRef<SyncConfig | null>(null);
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef("");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSyncRef = useRef<() => void>(() => {});

  const configIsCurrent = useCallback((active: SyncConfig) => {
    const current = configRef.current;
    return current?.baseUrl === active.baseUrl && current.token === active.token;
  }, []);

  const scheduleQueueRetry = useCallback((nextRetryAt: number | null) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (nextRetryAt === null) {
      return;
    }
    retryTimerRef.current = setTimeout(() => runSyncRef.current(), Math.max(0, nextRetryAt - Date.now()));
  }, []);

  const cacheMissingAttachments = useCallback(
    async (active: SyncConfig, nextBoard: BoardState) => {
      await Promise.all(
        Object.values(nextBoard.cards)
          .flatMap((card) => card.attachments)
          .map(async (attachment) => {
            if (await platform.attachments.exists(attachment.fileName)) {
              return;
            }
            try {
              const blob = await downloadRemoteAttachment(active, attachment.fileName);
              if (configIsCurrent(active)) {
                await platform.attachments.write(attachment.fileName, blob, attachment.mimeType);
              }
            } catch {
              // AttachmentItem keeps a visible failure state and can request another download.
            }
          }),
      );
    },
    [configIsCurrent, platform],
  );

  const processDeletesAfterBoard = useCallback(
    async (active: SyncConfig) => {
      if (!configIsCurrent(active)) {
        return;
      }
      // A deletion can be queued just before React publishes the board update.
      // Keep it parked while the latest local board still refers to that blob.
      const referenced = new Set(
        Object.values(boardRef.current.cards).flatMap((card) =>
          card.attachments.map((attachment) => attachment.fileName),
        ),
      );
      const result = await processQueue(active, platform, Date.now(), ["delete"], referenced);
      scheduleQueueRetry(result.nextRetryAt);
    },
    [configIsCurrent, platform, scheduleQueueRetry],
  );

  // board 為外部 prop，須在每次渲染後同步進 ref 供非同步流程讀取最新值；
  // config 的每個異動來源（初次載入 / enable / disable）都會同時手動同步 configRef，故不需額外 effect。
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const runSync = useCallback(async () => {
    if (!configRef.current) {
      return;
    }
    if (busyRef.current) {
      queuedRef.current = true;
      return;
    }
    busyRef.current = true;

    // 以迴圈取代自我遞迴呼叫：忙碌期間若有新的同步請求排入 queuedRef，
    // 於本輪結束後在同一次呼叫內原地重跑，避免函式在自身尚未完成賦值前就參照自己。
    let keepGoing = true;
    while (keepGoing) {
      // 每輪重新讀取設定：若使用者在同步期間 disable()（或改連新伺服器），
      // 排入佇列的重跑不得沿用舊設定，也不得覆寫 disable() 已設定的 "disabled" 狀態。
      const active = configRef.current;
      if (!active) {
        busyRef.current = false;
        queuedRef.current = false;
        return;
      }
      queuedRef.current = false;
      setStatus("syncing");
      setErrorMessage("");
      try {
        let baseRevision = loadSyncRevision();
        let candidate = boardRef.current;
        let done = false;

        // A board must never be published with a reference to a blob that has not
        // made it to R2 yet.  Deletes deliberately run only after board success.
        const uploads = await processQueue(active, platform, Date.now(), ["upload"]);
        scheduleQueueRetry(uploads.nextRetryAt);
        if (!configIsCurrent(active)) {
          busyRef.current = false;
          return;
        }
        const waitingUploads = pendingUploads(
          active,
          Object.values(candidate.cards).flatMap((card) => card.attachments.map((item) => item.fileName)),
        );
        if (waitingUploads.length > 0) {
          busyRef.current = false;
          queuedRef.current = false;
          setStatus("error");
          setErrorMessage(uploads.failure?.message ?? "附件正在等待上傳完成，將自動重試。");
          return;
        }

        // 本地自上次成功推送後無變更 → 僅拉取合併，避免無意義的推送與 revision ping-pong
        if (serializeBoard(candidate) === lastPushedRef.current) {
          if (!configIsCurrent(active)) {
            busyRef.current = false;
            return;
          }
          const remote = await fetchRemoteBoard(active);
          if (!configIsCurrent(active)) {
            busyRef.current = false;
            return;
          }
          if (!remote || remote.revision === baseRevision) {
            await processDeletesAfterBoard(active);
            setStatus("synced");
            done = true;
          } else {
            const remoteBoard = toBoardState(remote.board);
            const merged = mergeBoards(boardRef.current, remoteBoard);
            setBoard(merged);
            boardRef.current = merged; // 非 render 階段寫 ref 合法；讓後續回合立即以最新板為基準
            await cacheMissingAttachments(active, merged);
            if (serializeBoard(merged) === serializeBoard(remoteBoard)) {
              saveSyncRevision(remote.revision);
              lastPushedRef.current = serializeBoard(merged);
              await processDeletesAfterBoard(active);
              setStatus("synced");
              done = true;
            } else {
              baseRevision = remote.revision;
              candidate = merged;
            }
          }
        }

        if (!done) {
          for (let round = 0; round <= MAX_CONFLICT_ROUNDS && !done; round += 1) {
            if (!configIsCurrent(active)) {
              busyRef.current = false;
              return;
            }
            const result: PushResult = await pushRemoteBoard(active, baseRevision, candidate);
            if (!configIsCurrent(active)) {
              busyRef.current = false;
              return;
            }
            if (result.kind === "ok") {
              saveSyncRevision(result.revision);
              lastPushedRef.current = serializeBoard(candidate);
              await processDeletesAfterBoard(active);
              setStatus("synced");
              done = true;
              break;
            }
            if (result.board === null) {
              baseRevision = 0;
              continue;
            }
            const remoteBoard = toBoardState(result.board);
            const merged = mergeBoards(boardRef.current, remoteBoard);
            setBoard(merged);
            boardRef.current = merged;
            await cacheMissingAttachments(active, merged);
            if (serializeBoard(merged) === serializeBoard(remoteBoard)) {
              // 合併結果與遠端相同 → 直接採納，不需推送
              saveSyncRevision(result.revision);
              lastPushedRef.current = serializeBoard(merged);
              await processDeletesAfterBoard(active);
              setStatus("synced");
              done = true;
              break;
            }
            baseRevision = result.revision;
            candidate = merged;
          }
          if (!done) {
            throw new SyncApiError(409, "同步衝突重試次數過多，請稍後再試。");
          }
        }
      } catch (error) {
        busyRef.current = false;
        queuedRef.current = false;
        setStatus("error");
        if (error instanceof SyncApiError && error.status === 401) {
          setErrorMessage("同步憑證無效，請重新設定 token。本機資料不受影響。");
        } else if (error instanceof SyncApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("無法連線到同步伺服器，離線變更會保留在本機。");
        }
        return;
      }
      keepGoing = queuedRef.current;
    }
    busyRef.current = false;
  }, [cacheMissingAttachments, configIsCurrent, platform, processDeletesAfterBoard, scheduleQueueRetry, setBoard]);

  // 啟動載入設定 + 初次拉取
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const stored = loadSyncConfig();
    if (!stored) {
      return;
    }
    configRef.current = stored;
    void (async () => {
      setConfig(stored);
      setStatus("syncing");
      try {
        const remote = await fetchRemoteBoard(stored);
        if (!configIsCurrent(stored)) {
          return;
        }
        if (remote) {
          const merged = mergeBoards(boardRef.current, toBoardState(remote.board));
          saveSyncRevision(remote.revision);
          setBoard(merged);
          boardRef.current = merged;
          await cacheMissingAttachments(stored, merged);
        }
        await runSync();
      } catch {
        setStatus("error");
        setErrorMessage("啟動同步失敗，將於下次變更或手動重試時再試。");
      }
    })();
  }, [cacheMissingAttachments, configIsCurrent, loaded, runSync, setBoard]);

  // 看板變更 → debounce 推送
  useEffect(() => {
    if (!config || !loaded) {
      return;
    }
    if (serializeBoard(board) === lastPushedRef.current) {
      return;
    }
    setStatus((current) => (current === "syncing" ? current : "pending"));
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void runSync();
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [board, config, loaded, runSync]);

  // 回到前景 → 立即同步
  useEffect(() => {
    if (!config) {
      return;
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }
    function onOnline() {
      void runSync();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [config, runSync]);

  const enable = useCallback(
    async (next: SyncConfig, initialMode: "download" | "merge") => {
      saveSyncConfig(next);
      setConfig(next);
      configRef.current = next;
      setStatus("syncing");
      setErrorMessage("");
      try {
        const localCards = boardRef.current.cards;
        if (initialMode === "merge") {
          await enqueueExistingAttachments(next, platform, localCards);
        }
        const remote = await fetchRemoteBoard(next);
        if (!configIsCurrent(next)) {
          return;
        }
        if (remote) {
          const base =
            initialMode === "download"
              ? toBoardState(remote.board)
              : mergeBoards(boardRef.current, toBoardState(remote.board));
          saveSyncRevision(remote.revision);
          setBoard(base);
          // 立即同步 ref：download 模式下若不同步，緊接的 runSync 會把剛被捨棄的舊本地板
          // 推成新 revision，造成短暫的遠端回退視窗（其他裝置可能合併進而復活舊資料）。
          boardRef.current = base;
          await cacheMissingAttachments(next, base);
        } else {
          saveSyncRevision(0);
        }
        await runSync();
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof SyncApiError && error.status === 401
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
    configRef.current = null;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setStatus("disabled");
    setErrorMessage("");
  }, []);

  const syncNow = useCallback(() => {
    void runSync();
  }, [runSync]);

  const queueUploads = useCallback((attachments: AttachmentRef[]) => {
    const active = configRef.current;
    if (!active) {
      return;
    }
    for (const attachment of attachments) {
      enqueueUpload(active, attachment.fileName, attachment.mimeType);
    }
  }, []);

  const queueDeletes = useCallback((attachments: AttachmentRef[]) => {
    const active = configRef.current;
    if (!active) {
      return;
    }
    for (const attachment of attachments) {
      enqueueDelete(active, attachment.fileName);
    }
  }, []);

  useEffect(() => {
    runSyncRef.current = () => {
      void runSync();
    };
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [runSync]);

  return {
    status,
    errorMessage,
    configured: config !== null,
    syncNow,
    enable,
    disable,
    queueUploads,
    queueDeletes,
  };
}
