import type { BoardMeta, Project, ProjectRole } from "../../projects/types";
import {
  projectRoleLabel,
  serializeProjectRoute,
} from "../../projects/navigation";

export function BoardNavigation({
  project,
  board,
  boards,
  role,
}: {
  project: Project;
  board: BoardMeta;
  boards: BoardMeta[];
  role: ProjectRole;
}) {
  return (
    <nav className="boardNavigation" aria-label="專案與看板導覽">
      <div className="projectBreadcrumb">
        <a href="#/projects">我的專案</a>
        <span aria-hidden="true">/</span>
        <a href={serializeProjectRoute({ kind: "project", projectId: project.id })}>
          {project.name}
        </a>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">{board.name}</strong>
      </div>
      <div className="boardSwitcher">
        <label htmlFor="boardSwitcher">切換看板</label>
        <select
          id="boardSwitcher"
          value={board.id}
          onChange={(event) => {
            window.location.hash = serializeProjectRoute({
              kind: "board",
              projectId: project.id,
              boardId: event.target.value,
            });
          }}
        >
          {boards.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{entry.status === "archived" ? "（已封存）" : ""}
            </option>
          ))}
        </select>
        <span className="roleBadge">{projectRoleLabel(role)}</span>
      </div>
    </nav>
  );
}
