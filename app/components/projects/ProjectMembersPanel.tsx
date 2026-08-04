"use client";

import { useEffect, useState } from "react";
import {
  listProjectMembers,
  listProjectMemberCandidates,
  removeProjectMember,
  setProjectMember,
  type ProjectMember,
  type ProjectMemberCandidate,
} from "../../projects/api";
import type { ProjectRole } from "../../projects/types";
import {
  isLastOwnerChangeBlocked,
  managementErrorMessage,
} from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";

export function ProjectMembersPanel({
  config,
  projectId,
}: {
  config: SyncConfig;
  projectId: string;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("member");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<ProjectMemberCandidate[]>([]);

  async function reload() {
    try {
      const [nextMembers, nextCandidates] = await Promise.all([
        listProjectMembers(config, projectId),
        listProjectMemberCandidates(config, projectId),
      ]);
      setMembers(nextMembers);
      setCandidates(nextCandidates);
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    }
  }

  useEffect(() => {
    queueMicrotask(() => void reload());
  // Project/config identity changes remount this project panel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, projectId]);

  async function update(targetUserId: string, nextRole: ProjectRole | null) {
    if (!navigator.onLine) {
      setError(managementErrorMessage(null, false));
      return;
    }
    if (isLastOwnerChangeBlocked(members, targetUserId, nextRole)) {
      setError("至少要保留一位 Project Owner；請先新增或升級另一位 owner。");
      return;
    }
    setError("");
    try {
      if (nextRole) await setProjectMember(config, projectId, targetUserId, nextRole);
      else await removeProjectMember(config, projectId, targetUserId);
      await reload();
    } catch (cause) {
      setError(managementErrorMessage(cause, navigator.onLine));
    }
  }

  return (
    <section className="managementPanel">
      <div className="sectionHeading"><div><p className="eyebrow">Access</p><h2>專案成員</h2></div></div>
      <form
        className="memberAddForm"
        onSubmit={(event) => {
          event.preventDefault();
          void update(userId, role).then(() => setUserId(""));
        }}
      >
        <label className="formField">
          <span>使用者</span>
          <select required value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">選擇工作區使用者</option>
            {candidates.filter((candidate) => !candidate.currentRole).map((candidate) => (
              <option value={candidate.userId} key={candidate.userId}>
                {candidate.displayName}{candidate.email ? ` · ${candidate.email}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="formField"><span>角色</span><RoleSelect value={role} onChange={setRole} /></label>
        <button className="primaryButton" type="submit">新增／更新</button>
      </form>
      {error && <p className="notice warning" role="alert">{error}</p>}
      <div className="memberList">
        {members.map((member) => (
          <div className="memberRow" key={member.userId}>
            <div><strong>{member.displayName}</strong><small>{member.userId}</small></div>
            <RoleSelect value={member.role} onChange={(next) => void update(member.userId, next)} />
            <button className="dangerGhost" type="button" onClick={() => void update(member.userId, null)}>移除</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleSelect({ value, onChange }: { value: ProjectRole; onChange: (role: ProjectRole) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as ProjectRole)}>
      <option value="owner">Project Owner</option>
      <option value="member">Project Member</option>
      {value === "viewer" && <option value="viewer" disabled>唯讀成員（舊版）</option>}
    </select>
  );
}
