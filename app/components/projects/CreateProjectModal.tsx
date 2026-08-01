import { useState, type FormEvent } from "react";
import { createProject } from "../../projects/api";
import type { RuntimeSession } from "../../projects/session";
import { managementErrorMessage } from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";

type AdministrativeWorkspace = RuntimeSession["workspaces"][number];

export function CreateProjectModal({
  config,
  workspaces,
  onClose,
  onCreated,
}: {
  config: SyncConfig;
  workspaces: AdministrativeWorkspace[];
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspaceId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError(managementErrorMessage(null, false));
      return;
    }
    const workspace = workspaces.find((entry) => entry.workspaceId === workspaceId);
    if (!workspace) {
      setError("請選擇可管理的 Workspace。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const detail = await createProject(config, {
        id: crypto.randomUUID(),
        workspaceId,
        name,
      });
      onCreated(detail.project.id);
      onClose();
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop">
      <div className="modal compactModal" role="dialog" aria-modal="true" aria-labelledby="createProjectTitle">
        <form onSubmit={submit}>
          <header className="modalHeader">
            <div>
              <p className="modalEyebrow">平台管理</p>
              <h2 id="createProjectTitle">建立新專案</h2>
            </div>
            <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
          </header>
          <label className="formField">
            <span>專案名稱</span>
            <input
              autoFocus
              value={name}
              maxLength={80}
              required
              placeholder="例如：行動版產品開發"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="formField">
            <span>Workspace</span>
            <select
              value={workspaceId}
              required
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option value={workspace.workspaceId} key={workspace.workspaceId}>
                  {workspace.role === "owner" ? "擁有者" : "管理員"} · {workspace.workspaceId}
                </option>
              ))}
            </select>
          </label>
          <p className="storageNote">
            建立後你會自動成為此專案的管理者，再由專案內加入協作者與檢視者。
          </p>
          {error && <p className="notice warning" role="alert">{error}</p>}
          <footer className="modalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            <button className="primaryButton" type="submit" disabled={busy}>
              {busy ? "建立中…" : "建立專案"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
