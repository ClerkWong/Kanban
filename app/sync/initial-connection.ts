import {
  fetchRuntimeSession,
  type RuntimeSession,
} from "../projects/session";
import { saveSyncConfig, type SyncConfig } from "./config";
import { fetchLegacyRemoteBoard } from "./api";

type LegacyRemoteBoard = Awaited<ReturnType<typeof fetchLegacyRemoteBoard>>;

export type InitialConnection =
  | { kind: "stale" }
  | { kind: "projects"; session: RuntimeSession }
  | {
    kind: "legacy";
    session: RuntimeSession;
    remote: LegacyRemoteBoard;
  };

type InitialConnectionDependencies = {
  isCurrent: () => boolean;
  fetchSession?: (config: SyncConfig) => Promise<RuntimeSession>;
  fetchLegacyBoard?: (config: SyncConfig) => Promise<LegacyRemoteBoard>;
  persistConfig?: (config: SyncConfig) => void;
};

/**
 * Personal tokens belong to the multi-project client and must never be gated
 * by the legacy `/board` alias. Legacy tokens retain the old bootstrap path
 * until they are replaced.
 */
export async function prepareInitialConnection(
  config: SyncConfig,
  dependencies: InitialConnectionDependencies,
): Promise<InitialConnection> {
  const fetchSession = dependencies.fetchSession ?? fetchRuntimeSession;
  const fetchLegacyBoard =
    dependencies.fetchLegacyBoard ?? fetchLegacyRemoteBoard;
  const persistConfig = dependencies.persistConfig ?? saveSyncConfig;

  const session = await fetchSession(config);
  if (!dependencies.isCurrent()) return { kind: "stale" };

  persistConfig(config);
  if (session.user.tokenKind === "personal") {
    return { kind: "projects", session };
  }

  const remote = await fetchLegacyBoard(config);
  if (!dependencies.isCurrent()) return { kind: "stale" };
  return { kind: "legacy", session, remote };
}
