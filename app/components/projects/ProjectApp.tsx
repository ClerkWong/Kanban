"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BoardApp } from "../board/BoardApp";
import { bundledAppConfig, loadAppConfig, type AppConfig } from "../../app-config";
import { logoutSession } from "../../auth/api";
import { createEmptyBoard } from "../../board-model";
import {
  ApiClientError,
  createBoard,
  getProject,
  getProjectSummary,
  listBoards,
  listProjectMembers,
  listProjects,
  type ProjectDetail,
  type ProjectMember,
  type ProjectReport,
} from "../../projects/api";
import { currentMonth, todayString } from "../../projects/calendar-model";
import {
  boardBelongsToRoute,
  canViewManagerViews,
  deriveBoardAccess,
  parseProjectHash,
  resolveAuthorizedRoute,
  serializeProjectRoute,
  type BoardAccess,
  type ProjectRoute,
} from "../../projects/navigation";
import { rangeFrom } from "../../projects/resource-model";
import {
  calendarWorkspaceId,
  fetchRuntimeSession,
  hasPlatformAdminAccess,
  type RuntimeSession,
} from "../../projects/session";
import {
  loadActiveContext,
  saveActiveContext,
} from "../../projects/storage";
import type {
  BoardContext,
  BoardMeta,
  ProjectSummary,
} from "../../projects/types";
import { usePlatform } from "../../platform/context";
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from "../../sync/config";
import { LoginView } from "../auth/LoginView";
import { BoardNavigation } from "./BoardNavigation";
import { CalendarView } from "./CalendarView";
import { MyProjectsView } from "./MyProjectsView";
import { ResourceView } from "./ResourceView";
import { ProjectOverview } from "./ProjectOverview";
import { LegacyMigrationGate } from "./LegacyMigrationGate";
import { AdminProjectsView } from "./AdminProjectsView";

type ProjectAppProps = {
  enableServiceWorker?: boolean;
  appConfigUrl?: string;
};

type BootstrapState =
  | { kind: "loading" }
  | { kind: "signedOut"; message?: string }
  | {
    kind: "ready";
    config: SyncConfig;
    session: RuntimeSession;
    projects: ProjectSummary[];
  }
  | { kind: "error"; message: string };

export function ProjectApp({
  enableServiceWorker = false,
  appConfigUrl = "/app-config.json",
}: ProjectAppProps) {
  const platform = usePlatform();
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ kind: "loading" });
  const [route, setRoute] = useState<ProjectRoute>({ kind: "projects" });
  const [appConfig, setAppConfig] = useState<AppConfig>(bundledAppConfig);
  const [credentialRevision, setCredentialRevision] = useState(0);
  const [useLocalBoard, setUseLocalBoard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadAppConfig(appConfigUrl).then((config) => {
      if (!cancelled) {
        document.title = config.title;
        setAppConfig(config);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appConfigUrl]);

  useEffect(() => {
    let cancelled = false;
    void loadSyncConfig(platform.syncCredentials).then((config) => {
      if (cancelled) return;
      if (!config) {
        setBootstrap({ kind: "signedOut" });
        return;
      }
      void Promise.all([
        fetchRuntimeSession(config),
        listProjects(config, "active"),
        listProjects(config, "archived"),
      ])
        .then(([session, active, archived]) => {
          if (cancelled) return;
          setBootstrap({
            kind: "ready",
            config,
            session,
            projects: [...active, ...archived],
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (error instanceof ApiClientError && error.kind === "unauthorized") {
            void saveSyncConfig(null, platform.syncCredentials).finally(() => {
              if (!cancelled) {
                setBootstrap({ kind: "signedOut", message: "登入已過期，請重新登入。" });
              }
            });
            return;
          }
          setBootstrap({
            kind: "error",
            message: error instanceof Error
              ? error.message
              : "無法載入專案資料，請稍後再試。",
          });
        });
    });
    return () => {
      cancelled = true;
    };
  }, [credentialRevision, platform]);

  useEffect(() => {
    if (bootstrap.kind !== "ready") return;
    const syncRoute = () => {
      const lastContext = loadActiveContext(window.localStorage);
      const next = resolveAuthorizedRoute(
        parseProjectHash(window.location.hash),
        bootstrap.projects,
        lastContext,
        hasPlatformAdminAccess(bootstrap.session),
      );
      setRoute(next);
      const canonical = serializeProjectRoute(next);
      if (window.location.hash !== canonical) {
        window.history.replaceState(null, "", canonical);
      }
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, [bootstrap]);

  if (bootstrap.kind === "loading") {
    return <LoadingState message={`正在載入 ${appConfig.title}…`} />;
  }
  if (bootstrap.kind === "signedOut" && !useLocalBoard) {
    return (
      <LoginView
        appConfig={appConfig}
        message={bootstrap.message}
        onUseLocal={() => setUseLocalBoard(true)}
        onAuthenticated={async (config) => {
          await saveSyncConfig(config, platform.syncCredentials);
          setUseLocalBoard(false);
          setBootstrap({ kind: "loading" });
          setCredentialRevision((value) => value + 1);
        }}
      />
    );
  }
  if (bootstrap.kind === "signedOut") {
    return (
      <BoardApp
        enableServiceWorker={enableServiceWorker}
        appConfigUrl={appConfigUrl}
      />
    );
  }
  if (bootstrap.kind === "error") {
    return (
      <main className="projectShell">
        <section className="projectEmpty errorState" role="alert">
          <h1>無法載入專案</h1>
          <p>{bootstrap.message}</p>
          <p>本機看板資料仍然保留。請檢查同步設定或稍後重新載入。</p>
          <button className="primaryButton" type="button" onClick={() => window.location.reload()}>
            重新載入
          </button>
        </section>
      </main>
    );
  }

  const signOut = async () => {
    try {
      await logoutSession(bootstrap.config);
    } catch {
      // Local credential removal is authoritative for this device even when
      // the network is unavailable. The server session expires independently.
    }
    await saveSyncConfig(null, platform.syncCredentials);
    window.history.replaceState(null, "", "#/projects");
    setUseLocalBoard(false);
    setBootstrap({ kind: "signedOut" });
  };
  if (route.kind === "projects") {
    return (
      <LegacyMigrationGate
        config={bootstrap.config}
        session={bootstrap.session}
        projects={bootstrap.projects}
      >
        <MyProjectsView
          projects={bootstrap.projects}
          userName={bootstrap.session.user.displayName}
          showAdmin={hasPlatformAdminAccess(bootstrap.session)}
          showCalendar={canViewManagerViews(bootstrap.projects, hasPlatformAdminAccess(bootstrap.session))}
          showResources={canViewManagerViews(bootstrap.projects, hasPlatformAdminAccess(bootstrap.session))}
          onSignOut={() => void signOut()}
        />
      </LegacyMigrationGate>
    );
  }
  if (route.kind === "admin") {
    return (
      <LegacyMigrationGate
        config={bootstrap.config}
        session={bootstrap.session}
        projects={bootstrap.projects}
      >
        <AdminProjectsView
          config={bootstrap.config}
          session={bootstrap.session}
          memberProjects={bootstrap.projects}
          onSignOut={() => void signOut()}
          onProjectsChanged={async () => {
            const [active, archived] = await Promise.all([
              listProjects(bootstrap.config, "active"),
              listProjects(bootstrap.config, "archived"),
            ]);
            setBootstrap((current) => current.kind === "ready"
              ? { ...current, projects: [...active, ...archived] }
              : current);
          }}
        />
      </LegacyMigrationGate>
    );
  }
  if (route.kind === "calendar") {
    const workspaceId = calendarWorkspaceId(bootstrap.session);
    return (
      <LegacyMigrationGate
        config={bootstrap.config}
        session={bootstrap.session}
        projects={bootstrap.projects}
      >
        <CalendarView
          config={bootstrap.config}
          workspaceId={workspaceId}
          month={route.month ?? currentMonth()}
          userName={bootstrap.session.user.displayName}
          showAdmin={hasPlatformAdminAccess(bootstrap.session)}
          onSignOut={() => void signOut()}
        />
      </LegacyMigrationGate>
    );
  }
  if (route.kind === "resources") {
    const workspaceId = calendarWorkspaceId(bootstrap.session);
    // from／to 一次算出：route.from 可能來自 URL，若各自獨立算會讓 to 停在
    // 「今天起 13 天」那一段，跟使用者在 URL 指定的 from 對不起來。
    const range = rangeFrom(route.from ?? todayString());
    return (
      <LegacyMigrationGate
        config={bootstrap.config}
        session={bootstrap.session}
        projects={bootstrap.projects}
      >
        <ResourceView
          config={bootstrap.config}
          workspaceId={workspaceId}
          from={range.from}
          to={range.to}
          userName={bootstrap.session.user.displayName}
          showAdmin={hasPlatformAdminAccess(bootstrap.session)}
          onSignOut={() => void signOut()}
        />
      </LegacyMigrationGate>
    );
  }
  return (
    <LegacyMigrationGate
      config={bootstrap.config}
      session={bootstrap.session}
      projects={bootstrap.projects}
    >
      <ProjectRouteView
        config={bootstrap.config}
        route={route}
        enableServiceWorker={enableServiceWorker}
        appConfigUrl={appConfigUrl}
        onProjectsChanged={() => {
          void Promise.all([
            listProjects(bootstrap.config, "active"),
            listProjects(bootstrap.config, "archived"),
          ]).then(([active, archived]) => {
            setBootstrap((current) => current.kind === "ready"
              ? { ...current, projects: [...active, ...archived] }
              : current);
          }).catch(() => {});
        }}
      />
    </LegacyMigrationGate>
  );
}

function ProjectRouteView({
  config,
  route,
  enableServiceWorker,
  appConfigUrl,
  onProjectsChanged,
}: {
  config: SyncConfig;
  route: Exclude<
    ProjectRoute,
    { kind: "projects" } | { kind: "admin" } | { kind: "calendar" } | { kind: "resources" }
  >;
  enableServiceWorker: boolean;
  appConfigUrl: string;
  onProjectsChanged: () => void;
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<{
    detail: ProjectDetail | null;
    report: ProjectReport | null;
    members: ProjectMember[];
    activeBoards: BoardMeta[];
    allBoards: BoardMeta[];
    error: string;
  }>({
    detail: null,
    report: null,
    members: [],
    activeBoards: [],
    allBoards: [],
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState({
        detail: null,
        report: null,
        members: [],
        activeBoards: [],
        allBoards: [],
        error: "",
      });
    });
    void Promise.all([
      getProject(config, route.projectId),
      getProjectSummary(config, route.projectId),
      listProjectMembers(config, route.projectId),
      listBoards(config, route.projectId, "active"),
      listBoards(config, route.projectId, "archived"),
    ])
      .then(([detail, report, members, activeBoards, archivedBoards]) => {
        if (cancelled) return;
        const allBoards = [...activeBoards, ...archivedBoards];
        if (route.kind === "board" && !boardBelongsToRoute(route, allBoards)) {
          window.sessionStorage.setItem(
            "kanban-board-access-notice",
            "您已不在此看板。",
          );
          window.location.hash = serializeProjectRoute({
            kind: "project",
            projectId: route.projectId,
          });
          return;
        }
        if (
          route.kind === "project" &&
          detail.myRole === "member" &&
          activeBoards.length === 1
        ) {
          window.location.hash = serializeProjectRoute({
            kind: "board",
            projectId: route.projectId,
            boardId: activeBoards[0].id,
          });
          return;
        }
        const notice = window.sessionStorage.getItem("kanban-board-access-notice");
        if (notice) window.sessionStorage.removeItem("kanban-board-access-notice");
        setState({
          detail,
          report,
          members,
          activeBoards,
          allBoards,
          error: notice ?? "",
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (
          error instanceof ApiClientError &&
          (error.kind === "not_found" || error.kind === "forbidden")
        ) {
          window.sessionStorage.removeItem("kanban-board-access-notice");
          window.location.hash = serializeProjectRoute({ kind: "projects" });
          return;
        }
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "無法載入專案。",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [config, refreshToken, route]);

  const board = useMemo(
    () => route.kind === "board"
      ? state.allBoards.find((entry) => entry.id === route.boardId) ?? null
      : null,
    [route, state.allBoards],
  );

  async function handleCreateBoard(name: string): Promise<void> {
    const detail = state.detail;
    if (!detail) return;
    try {
      const created = await createBoard(config, {
        context: {
          workspaceId: detail.project.workspaceId,
          projectId: route.projectId,
        },
        boardId: crypto.randomUUID(),
        name,
        board: createEmptyBoard(),
      });
      window.location.hash = serializeProjectRoute({
        kind: "board",
        projectId: route.projectId,
        boardId: created.meta.id,
      });
      onProjectsChanged();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "建立看板失敗，請稍後再試。",
      }));
    }
  }

  if (state.error && !state.detail) {
    return <LoadingState message={state.error} error />;
  }
  if (!state.detail || !state.report) {
    return <LoadingState message="正在載入專案…" />;
  }

  const accessNotice = state.error && state.detail ? (
    <div className="notice readOnlyNotice" role="alert">
      {state.error}
      <button
        type="button"
        className="secondaryButton"
        onClick={() => setState((current) => ({ ...current, error: "" }))}
      >
        知道了
      </button>
    </div>
  ) : null;

  if (route.kind === "project") {
    return (
      <>
        {accessNotice}
        <ProjectOverview
          key={refreshToken}
          config={config}
          detail={state.detail}
          report={state.report}
          activeBoards={state.activeBoards}
          allBoards={state.allBoards}
          onRefresh={() => {
            setRefreshToken((current) => current + 1);
            onProjectsChanged();
          }}
          onCreateBoard={handleCreateBoard}
        />
      </>
    );
  }
  if (!board) return <LoadingState message="正在載入看板…" />;

  const context = {
    workspaceId: state.detail.project.workspaceId,
    projectId: state.detail.project.id,
    boardId: board.id,
  };
  const access = deriveBoardAccess(
    state.detail.myRole,
    state.detail.project.status,
    board.status,
  );

  return (
    <>
      {accessNotice}
      <ActiveBoard
        context={context}
        projectName={state.detail.project.name}
        access={access}
        projectMembers={state.members}
        navigation={(
            <BoardNavigation
              project={state.detail.project}
              board={board}
              boards={state.allBoards}
              role={state.detail.myRole}
            />
          )}
        enableServiceWorker={enableServiceWorker}
        appConfigUrl={appConfigUrl}
      />
    </>
  );
}

function ActiveBoard({
  context,
  projectName,
  access,
  projectMembers,
  navigation,
  enableServiceWorker,
  appConfigUrl,
}: {
  context: BoardContext;
  projectName: string;
  access: BoardAccess;
  projectMembers: ProjectMember[];
  navigation: ReactNode;
  enableServiceWorker: boolean;
  appConfigUrl: string;
}) {
  const { workspaceId, projectId, boardId } = context;
  useEffect(() => {
    saveActiveContext(window.localStorage, { workspaceId, projectId, boardId });
  }, [boardId, projectId, workspaceId]);
  return (
    <BoardApp
      context={context}
      projectName={projectName}
      access={access}
      projectMembers={projectMembers}
      navigation={navigation}
      enableServiceWorker={enableServiceWorker}
      appConfigUrl={appConfigUrl}
    />
  );
}

function LoadingState({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  return (
    <main className="projectShell">
      <section className={`projectEmpty ${error ? "errorState" : ""}`} role={error ? "alert" : "status"}>
        <p>{message}</p>
      </section>
    </main>
  );
}
