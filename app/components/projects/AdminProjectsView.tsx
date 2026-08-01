"use client";

import { useEffect, useMemo, useState } from "react";
import { listAdminProjects } from "../../projects/api";
import {
  administrativeWorkspaces,
  hasPlatformAdminAccess,
  type RuntimeSession,
} from "../../projects/session";
import type { AdminProjectSummary, ProjectSummary } from "../../projects/types";
import { managementErrorMessage } from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";
import { CreateProjectModal } from "./CreateProjectModal";
import { WorkspaceEntryNav } from "./WorkspaceEntryNav";

export function AdminProjectsView({
  config,
  session,
  memberProjects,
  onProjectsChanged,
}: {
  config: SyncConfig;
  session: RuntimeSession;
  memberProjects: ProjectSummary[];
  onProjectsChanged: () => Promise<void>;
}) {
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const workspaces = useMemo(() => administrativeWorkspaces(session), [session]);
  const memberProjectIds = useMemo(
    () => new Set(memberProjects.map((project) => project.id)),
    [memberProjects],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void listAdminProjects(config)
      .then((next) => {
        if (cancelled) return;
        setProjects(next);
        setError("");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(managementErrorMessage(cause, navigator.onLine));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, refreshToken]);

  const activeCount = projects.filter((project) => project.status === "active").length;
  const archivedCount = projects.length - activeCount;

  return (
    <main className="projectShell">
      <WorkspaceEntryNav
        current="admin"
        userName={session.user.displayName}
        showAdmin={hasPlatformAdminAccess(session)}
      />
      <header className="projectHero adminHero">
        <div>
          <p className="eyebrow">Workspace control</p>
          <h1>平台管理</h1>
          <p className="storageNote">
            建立專案並檢視管理資料。工作內容仍只對該專案成員開放。
          </p>
        </div>
        <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>
          ＋ 建立專案
        </button>
      </header>

      <section className="adminStats" aria-label="平台專案統計">
        <div className="stat"><span>全部專案</span><strong>{projects.length}</strong></div>
        <div className="stat ok"><span>進行中</span><strong>{activeCount}</strong></div>
        <div className="stat"><span>已封存</span><strong>{archivedCount}</strong></div>
        <div className="stat"><span>可管理 Workspace</span><strong>{workspaces.length}</strong></div>
      </section>

      <p className="adminScopeNotice">
        平台管理只顯示專案名稱、狀態、管理者與時間；不會顯示看板、卡片、附件、摘要或活動內容。
      </p>
      {createdProjectId && (
        <p className="notice successNotice">
          專案已建立。{memberProjectIds.has(createdProjectId)
            ? <a href={`#/projects/${createdProjectId}`}>進入新專案 →</a>
            : <span>正在更新你的專案入口…</span>}
        </p>
      )}
      {error && <p className="notice warning" role="alert">{error}</p>}

      {loading ? (
        <section className="projectEmpty" role="status"><p>正在載入平台專案…</p></section>
      ) : projects.length === 0 ? (
        <section className="projectEmpty">
          <h2>目前沒有專案</h2>
          <p>建立第一個專案後，再進入專案加入成員與建立看板。</p>
        </section>
      ) : (
        <section className="adminProjectList" aria-label="平台專案清單">
          {projects.map((project) => {
            const canOpen = memberProjectIds.has(project.id);
            return (
              <article className="adminProjectRow" key={project.id}>
                <div className="adminProjectHeading">
                  <div>
                    <h2>{project.name}</h2>
                    <code>{project.id}</code>
                  </div>
                  <span className={`statusBadge ${project.status}`}>
                    {project.status === "active" ? "進行中" : "已封存"}
                  </span>
                </div>
                <dl className="adminProjectFacts">
                  <div><dt>Workspace</dt><dd><code>{project.workspaceId}</code></dd></div>
                  <div>
                    <dt>專案管理者</dt>
                    <dd>{project.managerIds.length === 0
                      ? "尚未設定"
                      : project.managerIds.map((id) => <code key={id}>{id}</code>)}</dd>
                  </div>
                  <div><dt>更新時間</dt><dd>{new Date(project.updatedAt).toLocaleString("zh-TW")}</dd></div>
                </dl>
                <div className="adminProjectActions">
                  {canOpen ? (
                    <a className="secondaryButton" href={`#/projects/${project.id}`}>進入專案</a>
                  ) : (
                    <span>你尚未加入此專案，因此不能查看工作內容。</span>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {createOpen && (
        <CreateProjectModal
          config={config}
          workspaces={workspaces}
          onClose={() => setCreateOpen(false)}
          onCreated={(projectId) => {
            setCreatedProjectId(projectId);
            setRefreshToken((current) => current + 1);
            void onProjectsChanged().catch((cause: unknown) => {
              setError(managementErrorMessage(cause, navigator.onLine));
            });
          }}
        />
      )}
    </main>
  );
}
