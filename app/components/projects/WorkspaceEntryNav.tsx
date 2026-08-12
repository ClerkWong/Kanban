export function WorkspaceEntryNav({
  current,
  userName,
  showAdmin,
  showCalendar,
  onSignOut,
}: {
  current: "projects" | "admin" | "calendar";
  userName: string;
  showAdmin: boolean;
  showCalendar: boolean;
  onSignOut: () => void;
}) {
  return (
    <nav className="workspaceEntryNav" aria-label="工作區入口">
      <div className="workspaceEntryLinks">
        <a
          href="#/projects"
          className={current === "projects" ? "active" : ""}
          aria-current={current === "projects" ? "page" : undefined}
        >
          <strong>我的專案</strong>
          <small>一般使用者入口</small>
        </a>
        {showAdmin && (
          <a
            href="#/admin"
            className={current === "admin" ? "active" : ""}
            aria-current={current === "admin" ? "page" : undefined}
          >
            <strong>平台管理</strong>
            <small>管理者入口</small>
          </a>
        )}
        {showCalendar && (
          <a
            href="#/calendar"
            className={current === "calendar" ? "active" : ""}
            aria-current={current === "calendar" ? "page" : undefined}
          >
            <strong>日曆</strong>
            <small>本月可推進的任務</small>
          </a>
        )}
      </div>
      <div className="workspaceIdentity">
        <div><span>目前使用者</span><strong>{userName}</strong></div>
        <button type="button" onClick={onSignOut}>登出</button>
      </div>
    </nav>
  );
}
