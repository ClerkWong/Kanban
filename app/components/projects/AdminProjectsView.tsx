"use client";

import { useEffect, useMemo, useState } from "react";
import {
  archiveAdminProject,
  listAdminProjects,
  restoreAdminProject,
} from "../../projects/api";
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
import { AdminUsersPanel } from "./AdminUsersPanel";

export function AdminProjectsView({
  config,
  session,
  memberProjects,
  onSignOut,
  onProjectsChanged,
}: {
  config: SyncConfig;
  session: RuntimeSession;
  memberProjects: ProjectSummary[];
  onSignOut: () => void;
  onProjectsChanged: () => Promise<void>;
}) {
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [section, setSection] = useState<"projects" | "users">("projects");
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

  if (section === "users") {
    return (
      <main className="projectShell">
        <WorkspaceEntryNav
          current="admin"
          userName={session.user.displayName}
          showAdmin={hasPlatformAdminAccess(session)}
          showCalendar={hasPlatformAdminAccess(session)}
          showResources={hasPlatformAdminAccess(session)}
          onSignOut={onSignOut}
        />
        <header className="projectHero adminHero">
          <div>
            <p className="eyebrow">Workspace control</p>
            <h1>平台管理</h1>
            <p className="storageNote">分別管理專案結構與可登入的使用者帳號。</p>
          </div>
        </header>
        <AdminSectionTabs current={section} onChange={setSection} />
        <AdminUsersPanel config={config} currentUserId={session.user.id} workspaces={workspaces} />
      </main>
    );
  }

  async function changeStatus(project: AdminProjectSummary) {
    if (!navigator.onLine) {
      setError(managementErrorMessage(null, false));
      return;
    }
    setError("");
    try {
      if (project.status === "active") {
        await archiveAdminProject(config, project.id);
      } else {
        await restoreAdminProject(config, project.id);
      }
      setRefreshToken((current) => current + 1);
      await onProjectsChanged();
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    }
  }

  return (
    <main className="projectShell">
      <WorkspaceEntryNav
        current="admin"
        userName={session.user.displayName}
        showAdmin={hasPlatformAdminAccess(session)}
        showCalendar={hasPlatformAdminAccess(session)}
        showResources={hasPlatformAdminAccess(session)}
        onSignOut={onSignOut}
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

      <AdminSectionTabs current={section} onChange={setSection} />

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
          專案與看板已建立。{memberProjectIds.has(createdProjectId)
            ? <a href={`#/projects/${createdProjectId}`}>管理新專案 →</a>
            : <span>你不是此專案成員，因此只會在平台管理清單中看到 metadata。</span>}
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
                    <dt>Project Owner</dt>
                    <dd>{project.ownerIds.length === 0
                      ? "尚未設定"
                      : project.ownerIds.map((id) => <code key={id}>{id}</code>)}</dd>
                  </div>
                  <div><dt>唯一看板</dt><dd>{project.boardName ?? "尚未建立"}</dd></div>
                  <div><dt>更新時間</dt><dd>{new Date(project.updatedAt).toLocaleString("zh-TW")}</dd></div>
                </dl>
                <div className="adminProjectActions">
                  {canOpen ? (
                    <a className="secondaryButton" href={`#/projects/${project.id}`}>進入專案</a>
                  ) : (
                    <span>你尚未加入此專案，因此不能查看工作內容。</span>
                  )}
                  <button
                    className={project.status === "active" ? "dangerGhost" : "secondaryButton"}
                    type="button"
                    onClick={() => void changeStatus(project)}
                  >
                    {project.status === "active" ? "封存專案" : "還原專案"}
                  </button>
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
          currentUserId={session.user.id}
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

function AdminSectionTabs({
  current,
  onChange,
}: {
  current: "projects" | "users";
  onChange: (next: "projects" | "users") => void;
}) {
  return (
    <nav className="adminSectionTabs" aria-label="平台管理分類">
      <button type="button" className={current === "projects" ? "active" : ""} onClick={() => onChange("projects")}>
        專案管理
      </button>
      <button type="button" className={current === "users" ? "active" : ""} onClick={() => onChange("users")}>
        使用者管理
      </button>
    </nav>
  );
}
