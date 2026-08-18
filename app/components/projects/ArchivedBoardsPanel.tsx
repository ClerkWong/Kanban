import { useState } from "react";
import { restoreBoard, type ProjectDetail } from "../../projects/api";
import { serializeProjectRoute } from "../../projects/navigation";
import type { BoardMeta } from "../../projects/types";
import { managementErrorMessage } from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";

export function ArchivedBoardsPanel({
  config,
  detail,
  boards,
  canManage,
  onChanged,
}: {
  config: SyncConfig;
  detail: ProjectDetail;
  boards: BoardMeta[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  if (boards.length === 0) return null;
  return (
    <section className="managementPanel">
      <div className="sectionHeading"><div><p className="eyebrow">Archive</p><h2>封存看板</h2></div><span>{boards.length} 個</span></div>
      {error && <p className="notice warning" role="alert">{error}</p>}
      <div className="archivedList">
        {boards.map((board) => {
          const context = {
            workspaceId: detail.project.workspaceId,
            projectId: detail.project.id,
            boardId: board.id,
          };
          return (
            <div className="archivedRow" key={board.id}>
              <a href={serializeProjectRoute({ kind: "board", projectId: detail.project.id, boardId: board.id, view: "board" })}>{board.name}</a>
              {canManage && (
                <button className="secondaryButton" type="button" onClick={() => {
                  if (!navigator.onLine) {
                    setError(managementErrorMessage(null, false));
                    return;
                  }
                  void restoreBoard(config, context)
                    .then(onChanged)
                    .catch((cause) => setError(managementErrorMessage(cause, navigator.onLine)));
                }}>還原</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
