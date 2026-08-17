"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
} from "../../projects/api";
import type { RuntimeSession } from "../../projects/session";
import type { AdminUserSummary } from "../../projects/types";
import { managementErrorMessage } from "../../projects/view-model";
import type { SyncConfig } from "../../sync/config";
import { AdminUserProjectsModal } from "./AdminUserProjectsModal";

type AdministrativeWorkspace = RuntimeSession["workspaces"][number];

function workspaceRoleLabel(role: AdminUserSummary["workspaceRole"]): string {
  if (role === "owner") return "主要管理者";
  if (role === "admin") return "平台 Admin";
  return "一般使用者";
}

export function AdminUsersPanel({
  config,
  currentUserId,
  workspaces,
}: {
  config: SyncConfig;
  currentUserId: string;
  workspaces: AdministrativeWorkspace[];
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspaceId ?? "");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserSummary | null>(null);
  const [assigning, setAssigning] = useState<AdminUserSummary | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void listAdminUsers(config, workspaceId)
      .then((next) => {
        if (cancelled) return;
        setUsers(next);
        setError("");
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(managementErrorMessage(cause, navigator.onLine));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, refreshToken, workspaceId]);

  const counts = useMemo(() => ({
    active: users.filter((user) => user.status === "active").length,
    admins: users.filter((user) => user.workspaceRole === "owner" || user.workspaceRole === "admin").length,
    pendingLogin: users.filter((user) => !user.hasPassword || !user.email).length,
  }), [users]);

  return (
    <>
      <section className="userManagementHeader">
        <div>
          <h2>使用者管理</h2>
          <p>建立登入帳號、設定平台權限，以及停用不再使用的帳號。</p>
        </div>
        <div className="userManagementActions">
          {workspaces.length > 1 && (
            <label className="compactField">
              <span>Workspace</span>
              <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>
                    {workspace.workspaceId}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>
            ＋ 建立使用者
          </button>
        </div>
      </section>

      <section className="adminStats userStats" aria-label="使用者統計">
        <div className="stat"><span>全部使用者</span><strong>{users.length}</strong></div>
        <div className="stat ok"><span>啟用中</span><strong>{counts.active}</strong></div>
        <div className="stat"><span>平台管理者</span><strong>{counts.admins}</strong></div>
        <div className="stat"><span>尚未設定登入</span><strong>{counts.pendingLogin}</strong></div>
      </section>

      <p className="adminScopeNotice">
        平台角色只決定能否建立專案與管理帳號；專案內容仍由各 Project 的 Owner／Member 身分控制。
      </p>
      {error && <p className="notice warning" role="alert">{error}</p>}

      {loading ? (
        <section className="projectEmpty" role="status"><p>正在載入使用者…</p></section>
      ) : users.length === 0 ? (
        <section className="projectEmpty">
          <h2>目前沒有使用者</h2>
          <p>建立第一個帳號後，就能將他加入專案。</p>
        </section>
      ) : (
        <section className="adminUserList" aria-label="平台使用者清單">
          {users.map((user) => (
            <article className="adminUserRow" key={user.id}>
              <div className="userAvatar" aria-hidden="true">
                {user.displayName.trim().slice(0, 1).toLocaleUpperCase("zh-TW")}
              </div>
              <div className="adminUserIdentity">
                <div>
                  <h3>{user.displayName}</h3>
                  {user.id === currentUserId && <span className="selfBadge">你</span>}
                </div>
                <p>{user.email ?? "尚未設定電子郵件"}</p>
              </div>
              <dl className="adminUserFacts">
                <div><dt>平台角色</dt><dd>{workspaceRoleLabel(user.workspaceRole)}</dd></div>
                <div><dt>參與專案</dt><dd>{user.projectCount}</dd></div>
                <div>
                  <dt>最近登入</dt>
                  <dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-TW") : "尚未登入"}</dd>
                </div>
              </dl>
              <div className="adminUserStatus">
                <span className={`statusBadge ${user.status === "active" ? "active" : "archived"}`}>
                  {user.status === "active" ? "啟用" : "已停用"}
                </span>
                {!user.hasPassword && <span className="loginMissingBadge">未設定密碼</span>}
              </div>
              {/* 兩個按鈕同屬一個動作區，避免超出 .adminUserRow 的欄數而被擠到下一列。 */}
              <div className="adminUserActions">
                <button className="secondaryButton" type="button" onClick={() => setEditing(user)}>
                  管理
                </button>
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={() => setAssigning(user)}
                >
                  專案
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {createOpen && (
        <CreateUserModal
          config={config}
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => setRefreshToken((value) => value + 1)}
        />
      )}
      {editing && (
        <EditUserModal
          config={config}
          currentUserId={currentUserId}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setRefreshToken((value) => value + 1)}
        />
      )}
      {assigning && (
        <AdminUserProjectsModal
          config={config}
          workspaceId={workspaceId}
          user={assigning}
          onClose={() => setAssigning(null)}
          onChanged={() => setRefreshToken((token) => token + 1)}
        />
      )}
    </>
  );
}

function CreateUserModal({
  config,
  workspaceId,
  onClose,
  onSaved,
}: {
  config: SyncConfig;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceRole, setWorkspaceRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createAdminUser(config, { workspaceId, displayName, email, password, workspaceRole });
      onSaved();
      onClose();
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      setError(code === "email_conflict"
        ? "這個電子郵件已被其他帳號使用。"
        : managementErrorMessage(cause, navigator.onLine));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop">
      <div className="modal compactModal" role="dialog" aria-modal="true" aria-labelledby="createUserTitle">
        <form onSubmit={submit}>
          <header className="modalHeader">
            <div><p className="modalEyebrow">使用者管理</p><h2 id="createUserTitle">建立登入帳號</h2></div>
            <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
          </header>
          <label className="formField"><span>顯示名稱</span><input autoFocus required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="formField"><span>電子郵件</span><input type="email" autoComplete="off" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="formField"><span>初始密碼</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="formField">
            <span>平台角色</span>
            <select value={workspaceRole} onChange={(event) => setWorkspaceRole(event.target.value as "admin" | "member")}>
              <option value="member">一般使用者</option>
              <option value="admin">平台 Admin</option>
            </select>
          </label>
          <p className="storageNote">密碼至少 12 個字元。建立後可再由 Project Owner 加入個別專案。</p>
          {error && <p className="notice warning" role="alert">{error}</p>}
          <footer className="modalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            <button className="primaryButton" type="submit" disabled={busy}>{busy ? "建立中…" : "建立帳號"}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({
  config,
  currentUserId,
  user,
  onClose,
  onSaved,
}: {
  config: SyncConfig;
  currentUserId: string;
  user: AdminUserSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [workspaceRole, setWorkspaceRole] = useState<"owner" | "admin" | "member">(user.workspaceRole);
  const [status, setStatus] = useState<"active" | "disabled">(user.status);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateAdminUser(config, user.workspaceId, user.id, {
        displayName,
        email,
        status,
        ...(workspaceRole === "owner" ? {} : { workspaceRole }),
      });
      if (newPassword) {
        await resetAdminUserPassword(config, user.workspaceId, user.id, newPassword);
      }
      onSaved();
      onClose();
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      if (code === "email_conflict") setError("這個電子郵件已被其他帳號使用。");
      else if (code === "cannot_remove_own_access") setError("不能停用自己或移除自己的平台管理權限。");
      else setError(managementErrorMessage(cause, navigator.onLine));
    } finally {
      setBusy(false);
    }
  }

  const isSelf = user.id === currentUserId;
  const ownerLocked = user.workspaceRole === "owner";
  return (
    <div className="modalBackdrop">
      <div className="modal compactModal" role="dialog" aria-modal="true" aria-labelledby="editUserTitle">
        <form onSubmit={submit}>
          <header className="modalHeader">
            <div><p className="modalEyebrow">使用者管理</p><h2 id="editUserTitle">管理 {user.displayName}</h2></div>
            <button className="iconOnly" type="button" onClick={onClose} aria-label="關閉">×</button>
          </header>
          <label className="formField"><span>顯示名稱</span><input required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="formField"><span>電子郵件</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="formField">
            <span>平台角色</span>
            <select disabled={ownerLocked || isSelf} value={workspaceRole} onChange={(event) => setWorkspaceRole(event.target.value as "admin" | "member")}>
              {ownerLocked && <option value="owner">主要管理者</option>}
              <option value="member">一般使用者</option>
              <option value="admin">平台 Admin</option>
            </select>
          </label>
          <label className="formField">
            <span>帳號狀態</span>
            <select disabled={ownerLocked || isSelf} value={status} onChange={(event) => setStatus(event.target.value as "active" | "disabled")}>
              <option value="active">啟用</option>
              <option value="disabled">停用並撤銷所有憑證</option>
            </select>
          </label>
          <label className="formField">
            <span>重設密碼（選填）</span>
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} placeholder="留白表示不變更" onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <p className="storageNote">重設密碼會撤銷此使用者目前所有登入工作階段。</p>
          {error && <p className="notice warning" role="alert">{error}</p>}
          <footer className="modalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>取消</button>
            <button className="primaryButton" type="submit" disabled={busy}>{busy ? "儲存中…" : "儲存變更"}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
