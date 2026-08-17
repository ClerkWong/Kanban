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

/** 勾選「參與」時套用的角色。取最低權限，需要 owner 時再由角色下拉調整。 */
const DEFAULT_ASSIGN_ROLE: ProjectRole = "member";

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
  // Which projectId's failure is currently shown in `error`, or null when the
  // message is not owned by a specific row (e.g. the initial load failure).
  // A row's success only clears the banner it itself caused -- otherwise a
  // fast, unrelated project's success would silently wipe another project's
  // still-unresolved error (see applyRole).
  const errorProjectId = useRef<string | null>(null);

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
    // Snapshot only this row (not the whole array) so a later rollback can
    // restore just this project without clobbering other projects' rows that
    // may have been optimistically added/changed by concurrent applyRole
    // calls while this request was in flight. The generation guard below
    // ensures this snapshot is only ever applied back while it is still
    // accurate for this projectId (see the comment on the catch branch).
    const previousEntry = memberships.find((entry) => entry.projectId === projectId) ?? null;
    const generation = (generations.current[projectId] ?? 0) + 1;
    generations.current[projectId] = generation;

    // Every state write below is a functional update computed from `current`
    // -- never from the `memberships` closure captured above -- so it always
    // builds on the latest state, including any other project's optimistic
    // row added after this call started.
    setMemberships((current) => {
      if (!current) return current;
      if (next === "") return current.filter((entry) => entry.projectId !== projectId);
      const projectName = projects.find((entry) => entry.id === projectId)?.name ?? projectId;
      return current.some((entry) => entry.projectId === projectId)
        ? current.map((entry) =>
            entry.projectId === projectId ? { ...entry, role: next } : entry)
        : [...current, { projectId, projectName, role: next, status: "active" as const }];
    });

    try {
      if (next === "") {
        await removeProjectMember(config, projectId, user.id);
        if (generations.current[projectId] !== generation) return;
        // Confirm the removal against the latest state rather than assuming
        // the optimistic write above is still intact.
        setMemberships((current) =>
          current ? current.filter((entry) => entry.projectId !== projectId) : current);
      } else {
        const member = await setProjectMember(config, projectId, user.id, next);
        if (generations.current[projectId] !== generation) return;
        // Overwrite with the server's authoritative role rather than trusting
        // the optimistic value we sent (design spec section 5.2: success
        // overwrites local state with the server response).
        const projectName = projects.find((entry) => entry.id === projectId)?.name ?? projectId;
        setMemberships((current) => {
          if (!current) return current;
          const authoritative: AdminUserProjectMembership = {
            projectId,
            projectName,
            role: member.role,
            status: "active",
          };
          return current.some((entry) => entry.projectId === projectId)
            ? current.map((entry) => (entry.projectId === projectId ? authoritative : entry))
            : [...current, authoritative];
        });
      }
      // Only clear the banner if it belongs to this row (or has no owner,
      // e.g. it was never set) -- a different project's still-unresolved
      // error must survive this success.
      if (errorProjectId.current === null || errorProjectId.current === projectId) {
        setError("");
        errorProjectId.current = null;
      }
      onChanged();
    } catch (cause: unknown) {
      if (generations.current[projectId] !== generation) return;
      setMemberships((current) => {
        if (!current) return current;
        const withoutRow = current.filter((entry) => entry.projectId !== projectId);
        return previousEntry ? [...withoutRow, previousEntry] : withoutRow;
      });
      setError(membershipErrorMessage(cause));
      errorProjectId.current = projectId;
    }
  }

  return (
    <div className="modalBackdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="assignUserProjectsTitle">
        {/*
          No field in this modal is ever submitted -- every change applies
          immediately via applyRole. This <form> exists only so the
          `.modal form` CSS rule (globals.css) supplies the modal's padding
          and section spacing; onSubmit is blocked defensively even though
          the only focusable controls are <select>s and a type="button".
        */}
        <form onSubmit={(event) => event.preventDefault()}>
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
                      const joined = membership !== undefined;
                      return (
                        <div className="memberRow" key={project.id}>
                          <label className="memberJoinToggle">
                            <input
                              type="checkbox"
                              checked={joined}
                              onChange={(event) => void applyRole(
                                project.id,
                                event.target.checked ? DEFAULT_ASSIGN_ROLE : "",
                              )}
                            />
                            <strong>{project.name}</strong>
                          </label>
                          <AssignmentRoleSelect
                            projectName={project.name}
                            joined={joined}
                            value={membership?.role ?? DEFAULT_ASSIGN_ROLE}
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
        </form>
      </div>
    </div>
  );
}

/** 角色只在已勾選參與時可改；未參與時停用並顯示勾選後會套用的預設角色。
 *  「是否參與」一律由 checkbox 表達，因此這裡不再提供「未參與」選項——
 *  否則同一件事會有兩個入口，兩者不一致時使用者無從判斷哪個才算。 */
function AssignmentRoleSelect({
  projectName,
  joined,
  value,
  onChange,
}: {
  projectName: string;
  joined: boolean;
  value: ProjectRole;
  onChange: (next: ProjectRole) => void;
}) {
  return (
    <select
      value={value}
      disabled={!joined}
      aria-label={`${projectName} 的角色`}
      onChange={(event) => onChange(event.target.value as ProjectRole)}
    >
      <option value="owner">Project Owner</option>
      <option value="member">Project Member</option>
      {/* 舊版 viewer 只呈現不可再選；select 本身仍可用，管理者才能改成 owner／member。 */}
      {value === "viewer" && <option value="viewer" disabled>唯讀成員（舊版）</option>}
    </select>
  );
}
