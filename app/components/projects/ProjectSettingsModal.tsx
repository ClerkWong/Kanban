import { useState, type FormEvent } from "react";
import {
  archiveProject,
  renameProject,
  restoreProject,
  type ProjectDetail,
} from "../../projects/api";
import { managementErrorMessage } from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";

export function ProjectSettingsModal({
  config,
  detail,
  onClose,
  onChanged,
}: {
  config: SyncConfig;
  detail: ProjectDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(detail.project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(operation: () => Promise<unknown>) {
    if (!navigator.onLine) {
      setError(managementErrorMessage(null, false));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await operation();
      onChanged();
      onClose();
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (detail.project.status === "archived") return;
    void run(() => renameProject(config, detail.project.id, name));
  }

  return (
    <div className="modalBackdrop">
      <div className="modal compactModal" role="dialog" aria-modal="true" aria-labelledby="projectSettingsTitle">
        <form onSubmit={submit}>
          <header className="modalHeader">
            <h2 id="projectSettingsTitle">專案設定</h2>
            <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
          </header>
          <label className="formField">
            <span>專案名稱</span>
            <input autoFocus disabled={detail.project.status === "archived"} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} />
          </label>
          {error && <p className="notice warning" role="alert">{error}</p>}
          <footer className="modalActions">
            <button
              type="button"
              className={detail.project.status === "active" ? "dangerGhost" : "secondaryButton"}
              disabled={busy}
              onClick={() => void run(() => detail.project.status === "active"
                ? archiveProject(config, detail.project.id)
                : restoreProject(config, detail.project.id))}
            >
              {detail.project.status === "active" ? "封存專案" : "還原專案"}
            </button>
            <span className="actionSpacer" />
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            {detail.project.status === "active" && (
              <button className="primaryButton" type="submit" disabled={busy}>儲存名稱</button>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}
