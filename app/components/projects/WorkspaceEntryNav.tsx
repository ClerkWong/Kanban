export function WorkspaceEntryNav({
  current,
  userName,
  showAdmin,
}: {
  current: "projects" | "admin";
  userName: string;
  showAdmin: boolean;
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
      </div>
      <div className="workspaceIdentity">
        <span>目前使用者</span>
        <strong>{userName}</strong>
      </div>
    </nav>
  );
}
