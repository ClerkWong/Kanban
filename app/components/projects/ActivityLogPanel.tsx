"use client";

import { useEffect, useRef, useState } from "react";
import {
  listBoardLogs,
  listProjectLogs,
} from "../../projects/api";
import type { ActivityLogEntry, BoardMeta, Project } from "../../projects/types";
import {
  activityActionLabel,
  managementErrorMessage,
} from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";

export function ActivityLogPanel({
  config,
  project,
  boards,
}: {
  config: SyncConfig;
  project: Project;
  boards: BoardMeta[];
}) {
  const [boardId, setBoardId] = useState("");
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  async function load(append: boolean) {
    const generation = ++requestGeneration.current;
    try {
      const page = boardId
        ? await listBoardLogs(config, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          boardId,
        }, { limit: 25, cursor: append ? cursor ?? undefined : undefined })
        : await listProjectLogs(config, project.id, {
          limit: 25,
          cursor: append ? cursor ?? undefined : undefined,
        });
      if (generation !== requestGeneration.current) return;
      setLogs((current) => append ? [...current, ...page.logs] : page.logs);
      setCursor(page.nextCursor);
      setError("");
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(managementErrorMessage(cause, navigator.onLine));
    }
  }

  useEffect(() => {
    queueMicrotask(() => void load(false));
  // `load` intentionally follows the selected filter and project identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, config, project.id]);

  return (
    <section className="managementPanel">
      <div className="sectionHeading">
        <div><p className="eyebrow">Audit</p><h2>活動紀錄</h2></div>
        <select aria-label="活動紀錄看板篩選" value={boardId} onChange={(event) => setBoardId(event.target.value)}>
          <option value="">全部看板</option>
          {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
        </select>
      </div>
      {error && <p className="notice warning" role="alert">{error}</p>}
      {logs.length === 0 ? <p className="storageNote">尚無活動紀錄。</p> : (
        <ol className="activityList">
          {logs.map((log) => (
            <li key={log.id}>
              <strong>{activityActionLabel(log.action)}</strong>
              <span>{new Date(log.occurredAt).toLocaleString("zh-TW")}</span>
              <small>Actor {log.actorUserId}</small>
            </li>
          ))}
        </ol>
      )}
      {cursor && <button className="secondaryButton" type="button" onClick={() => void load(true)}>載入更多</button>}
    </section>
  );
}
