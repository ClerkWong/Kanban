"use client";

import { useState } from "react";
import {
  getProjectSummary,
  renameBoard,
  type ProjectDetail,
  type ProjectReport,
} from "../../projects/api";
import type { BoardMeta } from "../../projects/types";
import {
  projectRoleLabel,
  serializeProjectRoute,
} from "../../projects/navigation";
import {
  managementErrorMessage,
  projectManagementActions,
} from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { ArchivedBoardsPanel } from "./ArchivedBoardsPanel";
import { ProjectMembersPanel } from "./ProjectMembersPanel";
import { ProjectSettingsModal } from "./ProjectSettingsModal";

export function ProjectOverview({
  config,
  detail,
  report,
  activeBoards,
  allBoards,
  onRefresh,
  onCreateBoard,
}: {
  config: SyncConfig;
  detail: ProjectDetail;
  report: ProjectReport;
  activeBoards: BoardMeta[];
  allBoards: BoardMeta[];
  onRefresh: () => void;
  onCreateBoard: (name: string) => Promise<void>;
}) {
  const actions = projectManagementActions(detail.myRole, detail.project.status);
  const archivedBoards = allBoards.filter((board) => board.status === "archived");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archivedReport, setArchivedReport] = useState<ProjectReport | null>(null);
  const [error, setError] = useState("");

  const visibleReport = includeArchived && archivedReport ? archivedReport : report;

  async function toggleSummary(next: boolean) {
    setIncludeArchived(next);
    if (!next) {
      setArchivedReport(null);
      return;
    }
    try {
      setArchivedReport(await getProjectSummary(config, detail.project.id, true));
      setError("");
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    }
  }

  async function renameProjectBoard(board: BoardMeta) {
    if (!navigator.onLine) {
      setError(managementErrorMessage(null, false));
      return;
    }
    const context = {
      workspaceId: detail.project.workspaceId,
      projectId: detail.project.id,
      boardId: board.id,
    };
    try {
      const nextName = window.prompt("新的看板名稱", board.name)?.trim();
      if (!nextName || nextName === board.name) return;
      await renameBoard(config, context, nextName);
      setError("");
      onRefresh();
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    }
  }

  async function submitCreateBoard(name: string) {
    setCreateBusy(true);
    await onCreateBoard(name);
    setCreateBusy(false);
    setCreateOpen(false);
  }

  return (
    <main className="projectShell">
      <nav className="projectBreadcrumb" aria-label="目前位置">
        <a href="#/projects">我的專案</a><span aria-hidden="true">/</span>
        <span aria-current="page">{detail.project.name}</span>
      </nav>

      <header className="projectHero">
        <div>
          <p className="eyebrow">{projectRoleLabel(detail.myRole)}</p>
          <h1>{detail.project.name}</h1>
          <p className="storageNote">每個專案對應一個使用中看板；專案與看板名稱彼此獨立。</p>
        </div>
        <div className="projectHeroActions">
          <span className={`statusBadge ${detail.project.status}`}>
            {detail.project.status === "active" ? "進行中" : "已封存"}
          </span>
          {actions.showManagement && (
            <button className="secondaryButton" type="button" onClick={() => setSettingsOpen(true)}>專案設定</button>
          )}
        </div>
      </header>

      {detail.project.status === "archived" && (
        <p className="notice readOnlyNotice">此專案已封存；內容、附件、摘要與活動紀錄仍可讀取。</p>
      )}
      {error && <p className="notice warning" role="alert">{error}</p>}

      <div className="summaryToolbar">
        <label>
          <input type="checkbox" checked={includeArchived} onChange={(event) => void toggleSummary(event.target.checked)} />
          摘要包含封存看板
        </label>
      </div>
      <section className="projectStats" aria-label="專案摘要">
        <SummaryStat label="總工作" value={visibleReport.stats.total} />
        <SummaryStat label="進行中" value={visibleReport.stats.active} />
        <SummaryStat label="完成" value={visibleReport.stats.completed} />
        <SummaryStat label="逾期" value={visibleReport.stats.overdue} danger={visibleReport.stats.overdue > 0} />
      </section>

      <section className="boardDirectory">
        <div className="sectionHeading">
          <div><p className="eyebrow">Boards</p><h2>使用中看板</h2></div>
          <div className="sectionActions">
            <span>{activeBoards.length} 個</span>
            {actions.showManagement && (
              <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>＋ 新增看板</button>
            )}
          </div>
        </div>
        {activeBoards.length === 0 ? (
          <div className="projectEmpty">
            <h3>目前沒有使用中看板</h3>
            <p>{actions.showManagement ? "建立第一個看板開始工作。" : "請聯絡專案管理者。"}</p>
          </div>
        ) : (
          <div className="boardDirectoryGrid">
            {activeBoards.map((board) => (
              <article className="boardDirectoryCard boardManageCard" key={board.id}>
                <a href={serializeProjectRoute({ kind: "board", projectId: detail.project.id, boardId: board.id })}>
                  <h3>{board.name}</h3><p>Revision {board.revision}</p>
                </a>
                <span className="statusBadge active">使用中</span>
                {actions.showManagement && (
                  <div className="boardCardActions">
                    <button className="secondaryButton" type="button" onClick={() => void renameProjectBoard(board)}>改名</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <ArchivedBoardsPanel config={config} detail={detail} boards={archivedBoards} canManage={false} onChanged={onRefresh} />
      {actions.showManagement && (
        <ProjectMembersPanel config={config} projectId={detail.project.id} boards={activeBoards} />
      )}
      <ActivityLogPanel config={config} project={detail.project} boards={allBoards} />

      {settingsOpen && <ProjectSettingsModal config={config} detail={detail} onClose={() => setSettingsOpen(false)} onChanged={onRefresh} />}
      {createOpen && (
        <NewBoardDialog
          busy={createBusy}
          onClose={() => setCreateOpen(false)}
          onSubmit={(name) => void submitCreateBoard(name)}
        />
      )}
    </main>
  );
}

function SummaryStat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className={`stat ${danger ? "danger" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function NewBoardDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="modalBackdrop">
      <div className="modal compactModal" role="dialog" aria-modal="true" aria-labelledby="newBoardTitle">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(name);
          }}
        >
          <header className="modalHeader">
            <h2 id="newBoardTitle">新增看板</h2>
            <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
          </header>
          <label className="formField">
            <span>看板名稱</span>
            <input autoFocus value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} />
          </label>
          <p className="storageNote">新看板會從空白範本開始，名稱不必與專案相同。</p>
          <footer className="modalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            <button className="primaryButton" type="submit" disabled={busy}>建立</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
