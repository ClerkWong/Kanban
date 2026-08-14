"use client";

import { useEffect, useState } from "react";
import { ApiClientError, getAssignments } from "../../projects/api";
import { todayString } from "../../projects/calendar-model";
import { serializeProjectRoute } from "../../projects/navigation";
import {
  barSpanInWindow,
  dayRange,
  groupBarsByUser,
  overloadedDays,
  packLanes,
  shiftRange,
} from "../../projects/resource-model";
import type { ResourceBar, ResourceData } from "../../projects/types";
import type { SyncConfig } from "../../sync/config";
import { WorkspaceEntryNav } from "./WorkspaceEntryNav";

type ResourceLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ResourceData };

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/** 從 `YYYY-MM-DD` 字串算週幾（繁中「一」～「日」）。走 UTC 是為了與
 * resource-model.ts 的日期慣例一致，避免本地時區把邊界日期位移一天；這裡只是
 * 顯示格式轉換、不涉及範圍或排版計算，所以留在元件內、不進 resource-model.ts。 */
function weekdayLabel(day: string): string {
  return WEEKDAY_LABELS[new Date(`${day}T00:00:00Z`).getUTCDay()];
}

/** getAssignments 對不合理的查詢窗（Worker 回 400 invalid_range，例如天數超過
 * 31 天上限）目前只會落入 api.ts 通用的 server_error 文案（「讀取甘特圖 失敗，
 * 請稍後再試。」），看不出是日期範圍的問題。route parser 已經擋掉曆法上不存在
 * 的日期，但擋不住「日期合法、範圍太長」這種情形，所以在這裡補一個可讀訊息。 */
function resourceErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "invalid_range") {
    return "日期範圍不合法，請重新選擇。";
  }
  return error instanceof Error ? error.message : "無法載入人力甘特圖，請稍後再試。";
}

export function ResourceView({
  config,
  workspaceId,
  from,
  to,
  userName,
  showAdmin,
  onSignOut,
}: {
  config: SyncConfig;
  workspaceId: string;
  from: string;
  to: string;
  userName: string;
  showAdmin: boolean;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<ResourceLoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState({ kind: "loading" });
    });
    void getAssignments(config, workspaceId, from, to)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: resourceErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [config, workspaceId, from, to]);

  return (
    <main className="resourceShell">
      <WorkspaceEntryNav
        current="resources"
        userName={userName}
        showAdmin={showAdmin}
        showCalendar
        showResources
        onSignOut={onSignOut}
      />

      <p className="resourceNarrowNotice">
        人力甘特圖需要較寬的畫面，請在桌面瀏覽器使用。
      </p>

      <div className="resourceLayout">
        {state.kind === "loading" && (
          <section aria-label="人力甘特圖">
            <p role="status">讀取人力甘特圖…</p>
          </section>
        )}
        {state.kind === "error" && (
          <section aria-label="人力甘特圖">
            <p className="notice readOnlyNotice" role="alert">{state.message}</p>
          </section>
        )}
        {state.kind === "ready" && <ResourceBody from={from} to={to} data={state.data} />}
      </div>
    </main>
  );
}

function ResourceBody({ from, to, data }: { from: string; to: string; data: ResourceData }) {
  const today = todayString();
  const days = dayRange(from, to);
  const barsByUser = groupBarsByUser(data.bars);
  // 離開專案的成員不在 project_members 目錄中，但 Worker 仍可能因既有指派而
  // 回報他們的姓名（見 assignments.ts 的 departed 分支）；查無姓名時沿用
  // CardItem.tsx 既有的「已離開 (短ID)」格式，避免同一位使用者在不同畫面呈現
  // 不一致的名稱。
  const names = new Map(data.people.map((person) => [person.userId, person.displayName]));
  const nameOf = (userId: string) => names.get(userId) || `已離開 (${userId.slice(0, 8)})`;
  // 欄寬下限 50px：量過 .resourceOverload 徽章（0.62rem／900 字重／左右各 2px
  // padding）實際需要的寬度——單位數（「9 項並行」）量到 43.5px、雙位數
  // （「12 項並行」）量到 49.1px，50px 對兩者都留一點餘裕，不必縮文案或縮字級
  // 就能在窄欄位下維持數字不被裁切。超過 50px 仍嫌窄的極端情形（例如個位數
  // 天數的查詢窗，理論上不會發生）交給 .resourceGridScroll 既有的水平捲動
  // 吸收，與看板欄位溢出時的既有慣例一致。
  const dayColumns = `repeat(${days.length}, minmax(50px, 1fr))`;
  const windowLength = days.length;
  const prevFrom = shiftRange(from, to, -windowLength).from;
  const nextFrom = shiftRange(from, to, windowLength).from;

  return (
    <>
      <section aria-label="人力甘特圖">
        <header className="resourceHeader">
          <div>
            <h1>人力甘特圖</h1>
            <p className="resourceRangeLabel">
              {from} 至 {to}（共 {days.length} 天）
            </p>
          </div>
          <nav className="resourceNav" aria-label="切換查詢區間">
            <a href={serializeProjectRoute({ kind: "resources", from: prevFrom })}>
              上一段
            </a>
            <a href={serializeProjectRoute({ kind: "resources", from: today })}>
              今天
            </a>
            <a href={serializeProjectRoute({ kind: "resources", from: nextFrom })}>
              下一段
            </a>
          </nav>
        </header>

        {data.boardsTruncated && (
          <p className="notice" role="alert">
            看板數量超過 50 個，僅統計最近更新的 50 個看板。
          </p>
        )}
        {data.barsTruncated && (
          <p className="notice" role="alert">
            排程條數量超過 2000 條，僅顯示前 2000 條，可能有條子未列出。
          </p>
        )}

        {data.people.length === 0 ? (
          <p className="resourceEmpty">此範圍內沒有可顯示的成員。</p>
        ) : (
          <div className="resourceGridScroll">
            <div className="resourceGrid">
              <div className="resourceDateHeader">
                <div className="resourceCorner" aria-hidden="true" />
                <div className="resourceDateHeadRow" style={{ gridTemplateColumns: dayColumns }}>
                  {days.map((day) => (
                    <div
                      key={day}
                      className={`resourceDateHead${day === today ? " today" : ""}`}
                    >
                      <strong>{Number(day.slice(8))}</strong>
                      <small>{weekdayLabel(day)}</small>
                    </div>
                  ))}
                </div>
              </div>

              {data.people.map((person) => (
                <ResourceRow
                  key={person.userId}
                  displayName={nameOf(person.userId)}
                  bars={barsByUser.get(person.userId) ?? []}
                  days={days}
                  dayColumns={dayColumns}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="resourceSidebar" aria-label="未排期指派">
        <section aria-label="未排期指派">
          <h2>未排期指派</h2>
          {data.unscheduled.length === 0 ? (
            <p className="resourceEmpty">目前沒有未排期的指派。</p>
          ) : (
            <ul className="resourceUnscheduledList">
              {data.unscheduled.map((item) => (
                <li key={`${item.cardId}-${item.userId}`}>
                  <strong>{item.title}</strong>
                  <small>{item.projectName}</small>
                  <small>{nameOf(item.userId)}</small>
                </li>
              ))}
            </ul>
          )}
          {data.unscheduledTruncated && (
            <p className="notice">僅顯示前 200 筆未排期指派</p>
          )}
        </section>
      </aside>
    </>
  );
}

function ResourceRow({
  displayName,
  bars,
  days,
  dayColumns,
}: {
  displayName: string;
  bars: ResourceBar[];
  days: string[];
  dayColumns: string;
}) {
  const lanes = packLanes(bars);
  const laneCount = lanes.reduce((max, entry) => Math.max(max, entry.lane + 1), 1);
  const overloaded = overloadedDays(bars, days);

  return (
    <div className="resourceRow">
      <div className="resourceRowLabel">{displayName}</div>
      {bars.length === 0 ? (
        <p className="resourceRowEmpty">本期間無排程</p>
      ) : (
        <div
          className="resourceRowLanes"
          style={{
            gridTemplateColumns: dayColumns,
            gridTemplateRows: `16px repeat(${laneCount}, minmax(26px, auto))`,
          }}
        >
          {days.map((day, index) => {
            const count = overloaded.get(day);
            if (!count) return null;
            return (
              <div
                key={`overload-${day}`}
                className="resourceOverload"
                style={{ gridColumn: index + 1, gridRow: 1 }}
                title={`${count} 項並行`}
              >
                {count} 項並行
              </div>
            );
          })}
          {lanes.map(({ bar, lane }) => {
            const placement = barSpanInWindow(bar, days);
            // 防禦性斷言：Worker 端已經擋掉起訖顛倒的投入期間（見
            // worker-sync/src/assignments.ts 的 toBar／unscheduledFromRow），
            // 這裡是最後一道防線——span 不是正整數就整條跳過，不畫出寬度異常
            // 或反向的條子。
            if (!placement || placement.span <= 0) return null;
            const classes = ["resourceBar"];
            if (bar.blocked) classes.push("blocked");
            if (bar.serviceClass === "expedite") classes.push("expedite");
            return (
              <div
                // 同一人同一張卡出現兩段完全相同的投入期間時（理論上的退化情形，
                // 見 resource-model.ts 的 packLanes 註解），cardId／startDate／
                // endDate 三者都會撞在一起；加上 lane 保底唯一，因為 packLanes
                // 對這種同鍵的 bar 一定會分到不同 lane（同一 lane 需要
                // 「前一根 endDate < 本根 startDate」，兩段日期完全相同時這個
                // 條件恆不成立)。
                key={`${bar.cardId}-${bar.startDate}-${bar.endDate}-${lane}`}
                className={classes.join(" ")}
                style={{
                  gridColumn: `${placement.startIndex + 1} / span ${placement.span}`,
                  gridRow: lane + 2,
                }}
                title={`${bar.title}（${bar.projectName}）`}
              >
                <strong>{bar.title}</strong>
                {(bar.blocked || bar.serviceClass === "expedite") && (
                  <span className="resourceBarFlags">
                    {bar.blocked && <span>卡住</span>}
                    {bar.serviceClass === "expedite" && <span>加急</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
