"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getBoard } from "../../projects/api";
import {
  SERVER_LEGACY_CONTEXT,
  needsServerLegacyChoice,
} from "../../projects/migrate-legacy";
import type { RuntimeSession } from "../../projects/session";
import type { ProjectSummary } from "../../projects/types";
import type { SyncConfig } from "../../sync/config";
import { LegacyMigrationModal } from "./LegacyMigrationModal";

export function LegacyMigrationGate({
  config,
  session,
  projects,
  children,
}: {
  config: SyncConfig;
  session: RuntimeSession;
  projects: ProjectSummary[];
  children: ReactNode;
}) {
  const [remote, setRemote] = useState<Awaited<ReturnType<typeof getBoard>> | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [localLegacy, setLocalLegacy] = useState(false);
  const needsBoardChoice = localLegacy &&
    projects.some((project) => project.id === SERVER_LEGACY_CONTEXT.projectId);
  const needsToken = session.user.tokenKind === "legacy";

  useEffect(() => {
    queueMicrotask(() => setLocalLegacy(
      needsServerLegacyChoice(window.localStorage, SERVER_LEGACY_CONTEXT),
    ));
  }, []);

  useEffect(() => {
    if (!needsBoardChoice && !needsToken) return;
    let cancelled = false;
    void getBoard(config, SERVER_LEGACY_CONTEXT)
      .then((detail) => {
        if (!cancelled) setRemote(detail);
      })
      .catch(() => {
        // ProjectApp continues to show its normal API error states.
      });
    return () => {
      cancelled = true;
    };
  }, [config, needsBoardChoice, needsToken]);

  return (
    <>
      {children}
      {!dismissed && (remote || !needsBoardChoice) && (needsBoardChoice || needsToken) && (
        <LegacyMigrationModal
          config={config}
          session={session}
          context={SERVER_LEGACY_CONTEXT}
          remoteBoard={remote?.content.board ?? null}
          remoteRevision={remote?.content.revision ?? 0}
          needsBoardChoice={needsBoardChoice}
          onComplete={() => setDismissed(true)}
        />
      )}
    </>
  );
}
