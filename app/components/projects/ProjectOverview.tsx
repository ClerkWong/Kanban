import type { ProjectDetail, ProjectReport } from "../../projects/api";
import type { BoardMeta } from "../../projects/types";
import {
  projectRoleLabel,
  serializeProjectRoute,
} from "../../projects/navigation";

export function ProjectOverview({
  detail,
  report,
  boards,
}: {
  detail: ProjectDetail;
  report: ProjectReport;
  boards: BoardMeta[];
}) {
  return (
    <main className="projectShell">
      <nav className="projectBreadcrumb" aria-label="目前位置">
        <a href="#/projects">我的專案</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{detail.project.name}</span>
      </nav>

      <header className="projectHero">
        <div>
          <p className="eyebrow">{projectRoleLabel(detail.myRole)}</p>
          <h1>{detail.project.name}</h1>
          <p className="storageNote">選擇一個看板進行工作。專案與看板名稱彼此獨立。</p>
        </div>
        <span className={`statusBadge ${detail.project.status}`}>
          {detail.project.status === "active" ? "進行中" : "已封存"}
        </span>
      </header>

      <section className="projectStats" aria-label="專案摘要">
        <SummaryStat label="總工作" value={report.stats.total} />
        <SummaryStat label="進行中" value={report.stats.active} />
        <SummaryStat label="完成" value={report.stats.completed} />
        <SummaryStat label="逾期" value={report.stats.overdue} danger={report.stats.overdue > 0} />
      </section>

      <section className="boardDirectory">
        <div className="sectionHeading">
          <div><p className="eyebrow">Boards</p><h2>看板</h2></div>
          <span>{boards.length} 個</span>
        </div>
        {boards.length === 0 ? (
          <div className="projectEmpty">
            <h3>目前沒有看板</h3>
            <p>看板建立與管理功能會在下一階段加入。</p>
          </div>
        ) : (
          <div className="boardDirectoryGrid">
            {boards.map((board) => (
              <a
                className="boardDirectoryCard"
                href={serializeProjectRoute({
                  kind: "board",
                  projectId: detail.project.id,
                  boardId: board.id,
                })}
                key={board.id}
              >
                <div>
                  <h3>{board.name}</h3>
                  <p>Revision {board.revision}</p>
                </div>
                <span className={`statusBadge ${board.status}`}>
                  {board.status === "active" ? "使用中" : "已封存"}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className={`stat ${danger ? "danger" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
