"use client";

import { useState } from "react";
import type { BoardState } from "../../board-model";
import {
  adoptServerLegacyBoard,
  markServerLegacyAdopted,
  type ServerMigrationChoice,
} from "../../projects/migrate-legacy";
import {
  replaceLegacyToken,
  type RuntimeSession,
} from "../../projects/session";
import type { BoardContext } from "../../projects/types";
import { saveSyncConfig, type SyncConfig } from "../../sync/config";
import { pushRemoteBoard } from "../../sync/api";
import { saveBoardRevision } from "../../projects/storage";

export function LegacyMigrationModal({
  config,
  session,
  context,
  remoteBoard,
  remoteRevision,
  needsBoardChoice,
  onComplete,
}: {
  config: SyncConfig;
  session: RuntimeSession;
  context: BoardContext;
  remoteBoard: BoardState | null;
  remoteRevision: number;
  needsBoardChoice: boolean;
  onComplete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [boardDone, setBoardDone] = useState(!needsBoardChoice);
  const [newToken, setNewToken] = useState("");
  const tokenDone = session.user.tokenKind === "personal";

  async function choose(choice: ServerMigrationChoice) {
    if (!remoteBoard) return;
    setBusy(true);
    setError("");
    try {
      const adopted = adoptServerLegacyBoard(
        window.localStorage,
        context,
        remoteBoard,
        remoteRevision,
        choice,
      );
      if (choice === "merge") {
        const pushed = await pushRemoteBoard(
          config,
          context,
          remoteRevision,
          adopted.board,
        );
        if (pushed.kind === "conflict") {
          throw new Error("遠端看板在選擇期間已更新，請重新載入後再合併。");
        }
        saveBoardRevision(window.localStorage, context.boardId, pushed.revision);
      }
      markServerLegacyAdopted(window.localStorage, context);
      setBoardDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本機看板遷移失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function replaceToken() {
    setBusy(true);
    setError("");
    try {
      await replaceLegacyToken(config, newToken);
      saveSyncConfig({ baseUrl: config.baseUrl, token: newToken });
      if (boardDone) onComplete();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "個人 token 驗證失敗。");
    } finally {
      setBusy(false);
    }
  }

  function exportBackup() {
    const raw = window.localStorage.getItem("kanban-legacy-backup-v1");
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kanban-legacy-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modalBackdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="legacyMigrationTitle">
        <header className="modalHeader">
          <div>
            <p className="eyebrow">One-time migration</p>
            <h2 id="legacyMigrationTitle">升級舊版看板</h2>
          </div>
        </header>
        {needsBoardChoice && !boardDone && (
          <section className="migrationSection">
            <h3>選擇本機資料處理方式</h3>
            <p>合併會使用既有的卡片級時間與刪除墓碑規則；採用遠端則不匯入本機變更。兩者都會先保留一次可匯出的 backup。</p>
            <div className="migrationChoices">
              <button className="primaryButton" type="button" disabled={busy} onClick={() => void choose("merge")}>合併本機與遠端</button>
              <button className="secondaryButton" type="button" disabled={busy} onClick={() => void choose("remote")}>採用遠端資料</button>
            </div>
          </section>
        )}
        {boardDone && needsBoardChoice && (
          <p className="notice">本機選擇已保存。<button className="secondaryButton" type="button" onClick={exportBackup}>匯出 legacy backup</button></p>
        )}
        {!tokenDone && (
          <section className="migrationSection">
            <h3>換用個人 token</h3>
            <p>目前使用 shared legacy token。新 token 驗證為有效的個人 token 後，伺服器才會撤銷舊 token。</p>
            <label className="formField">
              <span>個人 token</span>
              <input type="password" autoComplete="off" value={newToken} onChange={(event) => setNewToken(event.target.value)} />
            </label>
            <button className="primaryButton" type="button" disabled={busy || newToken.length < 32} onClick={() => void replaceToken()}>驗證、切換並撤銷舊 token</button>
          </section>
        )}
        {error && <p className="notice warning" role="alert">{error}</p>}
        {boardDone && tokenDone && (
          <footer className="modalActions">
            <button className="primaryButton" type="button" onClick={onComplete}>完成</button>
          </footer>
        )}
      </div>
    </div>
  );
}
