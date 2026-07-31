import { useState, type FormEvent } from "react";
import { createDemoBoard } from "../../board-model";
import { createBoard, type ProjectDetail } from "../../projects/api";
import { managementErrorMessage } from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";

export function CreateBoardModal({
  config,
  detail,
  onClose,
  onCreated,
}: {
  config: SyncConfig;
  detail: ProjectDetail;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError(managementErrorMessage(null, false));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const template = createDemoBoard();
      await createBoard(config, {
        context: {
          workspaceId: detail.project.workspaceId,
          projectId: detail.project.id,
        },
        boardId: crypto.randomUUID(),
        name,
        board: {
          ...template,
          cards: {},
          deletedCards: {},
          columns: template.columns.map((column) => ({ ...column, cardIds: [] })),
          lastSavedAt: new Date().toISOString(),
        },
      });
      onCreated();
      onClose();
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop">
      <div className="modal compactModal" role="dialog" aria-modal="true" aria-labelledby="createBoardTitle">
        <form onSubmit={submit}>
          <header className="modalHeader">
            <h2 id="createBoardTitle">建立看板</h2>
            <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
          </header>
          <label className="formField">
            <span>看板名稱</span>
            <input autoFocus value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} />
          </label>
          <p className="storageNote">新看板會使用標準四欄範本，名稱不必與專案相同。</p>
          {error && <p className="notice warning" role="alert">{error}</p>}
          <footer className="modalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            <button className="primaryButton" type="submit" disabled={busy}>建立</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
