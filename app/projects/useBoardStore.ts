"use client";

import { createDemoBoard, type BoardState } from "../board-model";
import { loadBoardState, saveBoardState, type StorageLike } from "./storage";
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type BoardStoreHandle = {
  board: BoardState;
  setBoard: Dispatch<SetStateAction<BoardState>>;
  loaded: boolean;
  errorMessage: string;
};

type BoardSnapshot = {
  boardId: string | null;
  board: BoardState;
  errorMessage: string;
};

function resolveStorage(storage: StorageLike | undefined): StorageLike {
  if (storage) return storage;
  if (typeof window === "undefined") {
    throw new Error("Board storage 只能在瀏覽器環境載入。");
  }
  return window.localStorage;
}

/** Per-board local state. A Board switch makes the previous snapshot
 * immediately read-only; it cannot be saved under the next Board's key while
 * the new snapshot is loading. */
export function useBoardStore(
  boardId: string,
  storage?: StorageLike,
): BoardStoreHandle {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() => ({
    boardId: null,
    board: createDemoBoard(),
    errorMessage: "",
  }));

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const loaded = loadBoardState(resolveStorage(storage), boardId);
        if (cancelled) return;
        setSnapshot({
          boardId,
          board: loaded.board,
          errorMessage: loaded.error ?? "",
        });
      } catch (error) {
        if (cancelled) return;
        setSnapshot({
          boardId,
          board: createDemoBoard(),
          errorMessage:
            error instanceof Error ? error.message : "無法載入本機看板資料。",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, storage]);

  useEffect(() => {
    if (snapshot.boardId !== boardId) return;
    try {
      saveBoardState(resolveStorage(storage), boardId, snapshot.board);
    } catch {
      queueMicrotask(() => {
        setSnapshot((current) =>
          current.boardId === boardId
            ? {
              ...current,
              errorMessage: "儲存失敗：資料目前可能只在這個分頁可見。",
            }
            : current
        );
      });
    }
  }, [boardId, snapshot.board, snapshot.boardId, storage]);

  const setBoard = useCallback<Dispatch<SetStateAction<BoardState>>>(
    (next) => {
      setSnapshot((current) => {
        if (current.boardId !== boardId) {
          return current;
        }
        return {
          ...current,
          board:
            typeof next === "function"
              ? next(current.board)
              : next,
        };
      });
    },
    [boardId],
  );

  return {
    board: snapshot.board,
    setBoard,
    loaded: snapshot.boardId === boardId,
    errorMessage:
      snapshot.boardId === boardId ? snapshot.errorMessage : "",
  };
}
