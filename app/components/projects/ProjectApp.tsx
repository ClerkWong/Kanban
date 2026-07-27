"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BoardApp } from "../board/BoardApp";
import { bundledAppConfig, loadAppConfig } from "../../app-config";
import {
  ApiClientError,
  getProject,
  getProjectSummary,
  listBoards,
  listProjects,
  type ProjectDetail,
  type ProjectReport,
} from "../../projects/api";
import {
  boardBelongsToRoute,
  deriveBoardAccess,
  parseProjectHash,
  resolveAuthorizedRoute,
  serializeProjectRoute,
  type BoardAccess,
  type ProjectRoute,
} from "../../projects/navigation";
import { fetchRuntimeSession, type RuntimeSession } from "../../projects/session";
import {
  loadActiveContext,
  saveActiveContext,
} from "../../projects/storage";
import type {
  BoardContext,
  BoardMeta,
  ProjectSummary,
} from "../../projects/types";
import { loadSyncConfig, type SyncConfig } from "../../sync/config";
import { BoardNavigation } from "./BoardNavigation";
import { MyProjectsView } from "./MyProjectsView";
import { ProjectOverview } from "./ProjectOverview";
import { LegacyMigrationGate } from "./LegacyMigrationGate";

type ProjectAppProps = {
  enableServiceWorker?: boolean;
  appConfigUrl?: string;
};

type BootstrapState =
  | { kind: "loading" }
  | { kind: "local" }
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
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ kind: "loading" });
  const [route, setRoute] = useState<ProjectRoute>({ kind: "projects" });

  useEffect(() => {
    let cancelled = false;
    void loadAppConfig(appConfigUrl).then((config) => {
      if (!cancelled) document.title = config.title;
    });
    return () => {
      cancelled = true;
    };
  }, [appConfigUrl]);

  useEffect(() => {
    let cancelled = false;
    const config = loadSyncConfig();
    if (!config) {
      queueMicrotask(() => {
        if (!cancelled) setBootstrap({ kind: "local" });
      });
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
        setBootstrap({
          kind: "error",
          message: error instanceof Error
            ? error.message
            : "無法載入專案資料，請稍後再試。",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (bootstrap.kind !== "ready") return;
    const syncRoute = () => {
      const lastContext = loadActiveContext(window.localStorage);
      const next = resolveAuthorizedRoute(
        parseProjectHash(window.location.hash),
        bootstrap.projects,
        lastContext,
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
    return <LoadingState message={`正在載入 ${bundledAppConfig.title}…`} />;
  }
  if (bootstrap.kind === "local") {
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
  route: Exclude<ProjectRoute, { kind: "projects" }>;
  enableServiceWorker: boolean;
  appConfigUrl: string;
  onProjectsChanged: () => void;
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<{
    detail: ProjectDetail | null;
    report: ProjectReport | null;
    activeBoards: BoardMeta[];
    allBoards: BoardMeta[];
    error: string;
  }>({
    detail: null,
    report: null,
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
        activeBoards: [],
        allBoards: [],
        error: "",
      });
    });
    void Promise.all([
      getProject(config, route.projectId),
      getProjectSummary(config, route.projectId),
      listBoards(config, route.projectId, "active"),
      listBoards(config, route.projectId, "archived"),
    ])
      .then(([detail, report, activeBoards, archivedBoards]) => {
        if (cancelled) return;
        const allBoards = [...activeBoards, ...archivedBoards];
        if (route.kind === "board" && !boardBelongsToRoute(route, allBoards)) {
          window.location.hash = serializeProjectRoute({
            kind: "project",
            projectId: route.projectId,
          });
          return;
        }
        setState({
          detail,
          report,
          activeBoards,
          allBoards,
          error: "",
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (
          error instanceof ApiClientError &&
          (error.kind === "not_found" || error.kind === "forbidden")
        ) {
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

  if (state.error) {
    return <LoadingState message={state.error} error />;
  }
  if (!state.detail || !state.report) {
    return <LoadingState message="正在載入專案…" />;
  }
  if (route.kind === "project") {
    return (
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
      />
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
    <ActiveBoard
      context={context}
      access={access}
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
  );
}

function ActiveBoard({
  context,
  access,
  navigation,
  enableServiceWorker,
  appConfigUrl,
}: {
  context: BoardContext;
  access: BoardAccess;
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
      access={access}
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
