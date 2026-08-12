"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  listAdminProjects,
  listAdminUserProjects,
  removeProjectMember,
  setProjectMember,
} from "../../projects/api";
import type {
  AdminProjectSummary,
  AdminUserProjectMembership,
  AdminUserSummary,
  ProjectRole,
} from "../../projects/types";
import type { SyncConfig } from "../../sync/config";

function membershipErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError && cause.code === "last_owner") {
    return "此專案至少需要一位 owner，請先指派其他 owner。";
  }
  return cause instanceof Error ? cause.message : "更新專案成員失敗，請稍後再試。";
}

export function AdminUserProjectsModal({
  config,
  workspaceId,
  user,
  onClose,
  onChanged,
}: {
  config: SyncConfig;
  workspaceId: string;
  user: AdminUserSummary;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [memberships, setMemberships] = useState<AdminUserProjectMembership[] | null>(null);
  const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
  const [error, setError] = useState("");
  const generations = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listAdminUserProjects(config, workspaceId, user.id),
      listAdminProjects(config),
    ])
      .then(([nextMemberships, nextProjects]) => {
        if (cancelled) return;
        setMemberships(nextMemberships);
        setProjects(nextProjects);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "讀取專案清單失敗，請稍後再試。");
      });
    return () => { cancelled = true; };
  }, [config, workspaceId, user.id]);

  // Assignable projects: active projects in this workspace. AdminProjectSummary
  // carries workspaceId, so this filters both dimensions -- a multi-workspace
  // deployment never leaks another workspace's projects into this list.
  const activeProjects = useMemo(
    () => projects.filter(
      (project) => project.workspaceId === workspaceId && project.status === "active",
    ),
    [projects, workspaceId],
  );

  // Archived-project memberships are read-only history: the project can no
  // longer be edited, so these are listed separately with no role select.
  const archivedMemberships = useMemo(
    () => (memberships ?? []).filter((entry) => entry.status === "archived"),
    [memberships],
  );

  async function applyRole(projectId: string, next: ProjectRole | "") {
    if (!memberships) return;
    const previous = memberships;
    const generation = (generations.current[projectId] ?? 0) + 1;
    generations.current[projectId] = generation;
    const optimistic = next === ""
      ? previous.filter((entry) => entry.projectId !== projectId)
      : previous.some((entry) => entry.projectId === projectId)
        ? previous.map((entry) =>
            entry.projectId === projectId ? { ...entry, role: next } : entry)
        : [
            ...previous,
            {
              projectId,
              projectName: projects.find((entry) => entry.id === projectId)?.name ?? projectId,
              role: next,
              status: "active" as const,
            },
          ];
    setMemberships(optimistic);
    try {
      if (next === "") await removeProjectMember(config, projectId, user.id);
      else await setProjectMember(config, projectId, user.id, next);
      if (generations.current[projectId] !== generation) return;
      setError("");
      onChanged();
    } catch (cause: unknown) {
      if (generations.current[projectId] !== generation) return;
      setMemberships(previous);
      setError(membershipErrorMessage(cause));
    }
  }

  return (
    <div className="modalBackdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="assignUserProjectsTitle">
        <header className="modalHeader">
          <div>
            <p className="modalEyebrow">使用者管理</p>
            <h2 id="assignUserProjectsTitle">{user.displayName} 的專案</h2>
          </div>
          <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
        </header>

        {memberships === null ? (
          <p className="fieldHint" role="status">讀取中…</p>
        ) : (
          <>
            <section>
              <h3>使用中的專案</h3>
              {activeProjects.length === 0 ? (
                <p className="fieldHint">目前沒有使用中的專案可指派。</p>
              ) : (
                <div className="memberList">
                  {activeProjects.map((project) => {
                    const membership = memberships.find((entry) => entry.projectId === project.id);
                    return (
                      <div className="memberRow" key={project.id}>
                        <div><strong>{project.name}</strong></div>
                        <AssignmentRoleSelect
                          value={membership?.role ?? ""}
                          onChange={(next) => void applyRole(project.id, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {archivedMemberships.length > 0 && (
              <section>
                <h3>已封存的專案（唯讀）</h3>
                <div className="archivedList">
                  {archivedMemberships.map((entry) => (
                    <div className="archivedRow" key={entry.projectId}>
                      <span>{entry.projectName}</span>
                      <span className="statusBadge archived">已封存</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {error && <p className="notice readOnlyNotice" role="alert">{error}</p>}

        <footer className="modalActions">
          <button className="secondaryButton" type="button" onClick={onClose}>關閉</button>
        </footer>
      </div>
    </div>
  );
}

function AssignmentRoleSelect({
  value,
  onChange,
}: {
  value: ProjectRole | "";
  onChange: (next: ProjectRole | "") => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as ProjectRole | "")}>
      <option value="">未參與</option>
      <option value="owner">Project Owner</option>
      <option value="member">Project Member</option>
      {value === "viewer" && <option value="viewer" disabled>唯讀成員（舊版）</option>}
    </select>
  );
}
