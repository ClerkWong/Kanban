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
};

const DEBOUNCE_MS = 2000;
const MAX_CONFLICT_ROUNDS = 3;

function toBoardState(value: unknown): BoardState {
  // 遠端資料視同不可信持久化資料，走同一套防呆解析
  return parsePersistedBoard(JSON.stringify(value)).board;
}

export function useSync(
  board: BoardState,
  setBoard: Dispatch<SetStateAction<BoardState>>,
  loaded: boolean,
): SyncHandle {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>("disabled");
  const [errorMessage, setErrorMessage] = useState("");
  const boardRef = useRef(board);
  const configRef = useRef<SyncConfig | null>(null);
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef("");

  // board 為外部 prop，須在每次渲染後同步進 ref 供非同步流程讀取最新值；
  // config 的每個異動來源（初次載入 / enable / disable）都會同時手動同步 configRef，故不需額外 effect。
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const runSync = useCallback(async () => {
    const active = configRef.current;
    if (!active) {
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
      queuedRef.current = false;
      setStatus("syncing");
      setErrorMessage("");
      try {
        let baseRevision = loadSyncRevision();
        let candidate = boardRef.current;
        let done = false;

        // 本地自上次成功推送後無變更 → 僅拉取合併，避免無意義的推送與 revision ping-pong
        if (serializeBoard(candidate) === lastPushedRef.current) {
          const remote = await fetchRemoteBoard(active);
          if (!remote || remote.revision === baseRevision) {
            setStatus("synced");
            done = true;
          } else {
            const remoteBoard = toBoardState(remote.board);
            const merged = mergeBoards(boardRef.current, remoteBoard);
            setBoard(merged);
            if (serializeBoard(merged) === serializeBoard(remoteBoard)) {
              saveSyncRevision(remote.revision);
              lastPushedRef.current = serializeBoard(merged);
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
            const result: PushResult = await pushRemoteBoard(active, baseRevision, candidate);
            if (result.kind === "ok") {
              saveSyncRevision(result.revision);
              lastPushedRef.current = serializeBoard(candidate);
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
            if (serializeBoard(merged) === serializeBoard(remoteBoard)) {
              // 合併結果與遠端相同 → 直接採納，不需推送
              saveSyncRevision(result.revision);
              lastPushedRef.current = serializeBoard(merged);
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
  }, [setBoard]);

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
        if (remote) {
          const merged = mergeBoards(boardRef.current, toBoardState(remote.board));
          saveSyncRevision(remote.revision);
          setBoard(merged);
        }
        await runSync();
      } catch {
        setStatus("error");
        setErrorMessage("啟動同步失敗，將於下次變更或手動重試時再試。");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [config, runSync]);

  const enable = useCallback(
    async (next: SyncConfig, initialMode: "download" | "merge") => {
      saveSyncConfig(next);
      setConfig(next);
      configRef.current = next;
      setStatus("syncing");
      setErrorMessage("");
      try {
        const remote = await fetchRemoteBoard(next);
        if (remote) {
          const base =
            initialMode === "download"
              ? toBoardState(remote.board)
              : mergeBoards(boardRef.current, toBoardState(remote.board));
          saveSyncRevision(remote.revision);
          setBoard(base);
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
    [runSync, setBoard],
  );

  const disable = useCallback(() => {
    saveSyncConfig(null);
    setConfig(null);
    configRef.current = null;
    setStatus("disabled");
    setErrorMessage("");
  }, []);

  const syncNow = useCallback(() => {
    void runSync();
  }, [runSync]);

  return { status, errorMessage, configured: config !== null, syncNow, enable, disable };
}
