"use client";

import { useEffect, useState } from "react";
import { getCalendar } from "../../projects/api";
import {
  assigneeLoad,
  currentMonth,
  groupCardsByDueDate,
  isOverdue,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayString,
} from "../../projects/calendar-model";
import { serializeProjectRoute } from "../../projects/navigation";
import type { CalendarData } from "../../projects/types";
import type { SyncConfig } from "../../sync/config";
import { WorkspaceEntryNav } from "./WorkspaceEntryNav";

type CalendarLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: CalendarData };

export function CalendarView({
  config,
  workspaceId,
  month,
  userName,
  onSignOut,
}: {
  config: SyncConfig;
  workspaceId: string;
  month: string;
  userName: string;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<CalendarLoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState({ kind: "loading" });
    });
    void getCalendar(config, workspaceId, month)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "無法載入日曆，請稍後再試。",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [config, workspaceId, month]);

  return (
    <main className="calendarShell">
      <WorkspaceEntryNav
        current="calendar"
        userName={userName}
        showAdmin
        onSignOut={onSignOut}
      />

      <p className="calendarNarrowNotice">
        日曆檢視需要較寬的畫面，請在桌面瀏覽器使用。
      </p>

      <div className="calendarLayout">
        {state.kind === "loading" && (
          <section aria-label="月曆">
            <p role="status">讀取日曆…</p>
          </section>
        )}
        {state.kind === "error" && (
          <section aria-label="月曆">
            <p className="notice readOnlyNotice" role="alert">{state.message}</p>
          </section>
        )}
        {state.kind === "ready" && <CalendarBody month={month} data={state.data} />}
      </div>
    </main>
  );
}

function CalendarBody({ month, data }: { month: string; data: CalendarData }) {
  const today = todayString();
  const grid = monthGrid(month);
  const byDate = groupCardsByDueDate(data.scheduled);
  const load = assigneeLoad(data.scheduled, data.assignees);
  // 離開 workspace 的成員不在目錄中。沿用 CardItem.tsx 既有的
  // 「已離開 (短ID)」格式，避免同一位使用者在日曆與看板呈現不一致的名稱。
  const assigneeNames = new Map(data.assignees.map((entry) => [entry.userId, entry.displayName]));
  const nameOf = (userId: string) =>
    assigneeNames.get(userId) ?? `已離開 (${userId.slice(0, 8)})`;

  return (
    <>
      <section aria-label="月曆">
        <header className="calendarHeader">
          <h1>{monthLabel(month)}</h1>
          <div className="calendarNav">
            <a href={serializeProjectRoute({ kind: "calendar", month: shiftMonth(month, -1) })}>
              上月
            </a>
            <a href={serializeProjectRoute({ kind: "calendar", month: currentMonth() })}>
              本月
            </a>
            <a href={serializeProjectRoute({ kind: "calendar", month: shiftMonth(month, 1) })}>
              下月
            </a>
          </div>
        </header>

        {data.boardsTruncated && (
          <p className="notice" role="alert">
            看板數量超過 50 個，僅統計最近更新的 50 個看板。
          </p>
        )}

        <div className="calendarWeekdays" aria-hidden="true">
          {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="calendarGrid">
          {grid.map((cell) => {
            const cards = byDate[cell.date] ?? [];
            const classes = ["calendarCell"];
            if (!cell.inMonth) classes.push("outside");
            if (cell.date === today) classes.push("today");
            return (
              <div key={cell.date} className={classes.join(" ")}>
                <div className="calendarCellHead">
                  <span>{Number(cell.date.slice(8))}</span>
                  {cards.length > 0 && <small>{cards.length} 張</small>}
                </div>
                {cards.map((card) => {
                  const cardClasses = ["calendarCard"];
                  if (isOverdue(card.dueDate, today)) cardClasses.push("overdue");
                  if (card.blocked) cardClasses.push("blockedCard");
                  if (card.serviceClass === "expedite") cardClasses.push("expedite");
                  return (
                    <article key={card.cardId} className={cardClasses.join(" ")}>
                      <strong>{card.title}</strong>
                      <small>{card.projectName}</small>
                      {card.assigneeUserIds.length > 0 && (
                        <small>{card.assigneeUserIds.map(nameOf).join("、")}</small>
                      )}
                      <span className="calendarFlags">
                        {isOverdue(card.dueDate, today) && <span>已逾期</span>}
                        {card.blocked && <span>卡住</span>}
                        {card.serviceClass === "expedite" && <span>加急</span>}
                      </span>
                    </article>
                  );
                })}
              </div>
            );
          })}
        </div>

        {data.scheduled.length === 0 && (
          <p className="calendarEmpty">
            本月沒有排定的任務；可從右側未排程池挑選要推進的工作。
          </p>
        )}
      </section>

      <aside className="calendarSidebar" aria-label="未排程與人力負擔">
        <section aria-label="未排程池">
          <h2>未排程池</h2>
          {data.unscheduled.length === 0 ? (
            <p className="calendarEmpty">目前沒有未排程的任務。</p>
          ) : (
            <ul className="calendarUnscheduledList">
              {data.unscheduled.map((card) => (
                <li key={card.cardId}>
                  <strong>{card.title}</strong>
                  <small>{card.projectName}</small>
                  {card.assigneeUserIds.length > 0 && (
                    <small>{card.assigneeUserIds.map(nameOf).join("、")}</small>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.unscheduledTruncated && (
            <p className="notice">僅顯示前 200 筆未排程任務</p>
          )}
        </section>

        <section aria-label="每人本月件數">
          <h2>每人本月件數</h2>
          <ul className="calendarLoadList">
            {load.entries.map((entry) => (
              <li key={entry.userId}>
                <span>{nameOf(entry.userId)}</span>
                <strong>{entry.count} 張</strong>
              </li>
            ))}
            <li>
              <span>未指派</span>
              <strong>{load.unassignedCount} 張</strong>
            </li>
          </ul>
        </section>
      </aside>
    </>
  );
}
