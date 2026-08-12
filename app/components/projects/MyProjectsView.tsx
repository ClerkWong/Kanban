import type { ProjectSummary } from "../../projects/types";
import { projectRoleLabel, serializeProjectRoute } from "../../projects/navigation";
import { WorkspaceEntryNav } from "./WorkspaceEntryNav";

export function MyProjectsView({
  projects,
  userName,
  showAdmin,
  showCalendar,
  onSignOut,
}: {
  projects: ProjectSummary[];
  userName: string;
  showAdmin: boolean;
  showCalendar: boolean;
  onSignOut: () => void;
}) {
  return (
    <main className="projectShell">
      <WorkspaceEntryNav
        current="projects"
        userName={userName}
        showAdmin={showAdmin}
        showCalendar={showCalendar}
        onSignOut={onSignOut}
      />
      <header className="projectHero">
        <div>
          <p className="eyebrow">Kanban workspace</p>
          <h1>我的專案</h1>
          <p className="storageNote">
            {userName}，這裡只列出你參與的專案。
          </p>
        </div>
        <span className="projectCount">{projects.length} 個專案</span>
      </header>

      {projects.length === 0 ? (
        <section className="projectEmpty">
          <h2>目前沒有可查看的專案</h2>
          <p>請專案管理者將你加入專案，或確認目前登入帳號是否正確。</p>
        </section>
      ) : (
        <section className="projectGrid" aria-label="我的專案">
          {projects.map((project) => {
            const destination = project.boardId
              ? serializeProjectRoute({
                kind: "board",
                projectId: project.id,
                boardId: project.boardId,
              })
              : serializeProjectRoute({ kind: "project", projectId: project.id });
            return (
            <article className="projectCard" key={project.id}>
              <a className="projectCardMainLink" href={destination}>
              <div className="projectCardHeading">
                <h2>{project.name}</h2>
                <span className={`statusBadge ${project.status}`}>{
                  project.status === "active" ? "進行中" : "已封存"
                }</span>
              </div>
              <dl className="projectFacts">
                <div><dt>我的角色</dt><dd>{projectRoleLabel(project.myRole)}</dd></div>
                <div><dt>看板</dt><dd>{project.boardName ?? "尚未建立"}</dd></div>
                <div>
                  <dt>最近活動</dt>
                  <dd>{project.lastActivityAt
                    ? new Date(project.lastActivityAt).toLocaleString("zh-TW")
                    : "尚無紀錄"}</dd>
                </div>
              </dl>
              <span className="projectCardLink">進入看板 →</span>
              </a>
              {project.myRole === "owner" && (
                <a className="projectManageLink" href={serializeProjectRoute({ kind: "project", projectId: project.id })}>
                  專案與成員管理
                </a>
              )}
            </article>
          )})}
        </section>
      )}
    </main>
  );
}
