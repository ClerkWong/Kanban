import type { SyncConfig } from "../sync/config";
import { listBoards, listProjects } from "./api";
import { fetchRuntimeSession, type RuntimeSession } from "./session";
import type { BoardMeta, ProjectSummary, ResourceStatus } from "./types";

export type RemoteIndex = {
  projects: ProjectSummary[];
  boardsByProject: Record<string, BoardMeta[]>;
};

type SessionLoader = (config: SyncConfig) => Promise<RuntimeSession>;

function sameConfig(left: SyncConfig | null, right: SyncConfig): boolean {
  return left?.baseUrl === right.baseUrl && left.token === right.token;
}

export class ProjectRepository {
  private config: SyncConfig | null = null;
  private session: RuntimeSession | null = null;
  private remoteIndex: RemoteIndex = { projects: [], boardsByProject: {} };
  private generation = 0;

  constructor(private readonly loadSession: SessionLoader = fetchRuntimeSession) {}

  getSession(): RuntimeSession | null {
    return this.session
      ? {
        user: { ...this.session.user },
        workspaces: this.session.workspaces.map((workspace) => ({ ...workspace })),
      }
      : null;
  }

  getRemoteIndex(): RemoteIndex {
    return {
      projects: this.remoteIndex.projects.map((project) => ({ ...project })),
      boardsByProject: Object.fromEntries(
        Object.entries(this.remoteIndex.boardsByProject).map(([projectId, boards]) => [
          projectId,
          boards.map((board) => ({ ...board })),
        ]),
      ),
    };
  }

  async connect(config: SyncConfig): Promise<RuntimeSession | null> {
    if (sameConfig(this.config, config) && this.session) return this.getSession();
    const generation = ++this.generation;
    this.config = null;
    this.session = null;
    this.remoteIndex = { projects: [], boardsByProject: {} };
    const session = await this.loadSession(config);
    if (generation !== this.generation) return null;
    this.config = { ...config };
    this.session = session;
    return this.getSession();
  }

  disconnect(): void {
    this.generation += 1;
    this.config = null;
    this.session = null;
    this.remoteIndex = { projects: [], boardsByProject: {} };
  }

  async refreshProjects(status: ResourceStatus = "active"): Promise<ProjectSummary[]> {
    const active = this.requireConnection();
    const generation = this.generation;
    const projects = await listProjects(active, status);
    if (generation !== this.generation) return [];
    this.remoteIndex.projects = projects;
    return projects.map((project) => ({ ...project }));
  }

  async refreshBoards(
    projectId: string,
    status: ResourceStatus = "active",
  ): Promise<BoardMeta[]> {
    const active = this.requireConnection();
    const generation = this.generation;
    const boards = await listBoards(active, projectId, status);
    if (generation !== this.generation) return [];
    this.remoteIndex.boardsByProject[projectId] = boards;
    return boards.map((board) => ({ ...board }));
  }

  private requireConnection(): SyncConfig {
    if (!this.config || !this.session) {
      throw new Error("尚未建立同步 session。");
    }
    return this.config;
  }
}
