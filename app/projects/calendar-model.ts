import type { CalendarCard } from "./types";

export type CalendarGridCell = { date: string; inMonth: boolean };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
}

/** 覆蓋整個月份的日曆格子，週日起始並補滿完整週（符合多數 zh-TW 日曆慣例）。 */
export function monthGrid(month: string): CalendarGridCell[] {
  const { year, monthIndex } = monthParts(month);
  const first = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - first.getDay());
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const totalCells = Math.ceil((first.getDay() + lastDay) / 7) * 7;
  const cells: CalendarGridCell[] = [];
  for (let offset = 0; offset < totalCells; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    cells.push({
      date: localDateString(date),
      inMonth: date.getMonth() === monthIndex && date.getFullYear() === year,
    });
  }
  return cells;
}

export function monthLabel(month: string): string {
  const { year, monthIndex } = monthParts(month);
  return `${year} 年 ${monthIndex + 1} 月`;
}

export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = monthParts(month);
  const shifted = new Date(year, monthIndex + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

export function currentMonth(today = new Date()): string {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

/** 本地日期字串；UI 用它判定「今天」的格子與逾期比較。 */
export function todayString(today = new Date()): string {
  return localDateString(today);
}

export function groupCardsByDueDate(cards: CalendarCard[]): Record<string, CalendarCard[]> {
  const grouped: Record<string, CalendarCard[]> = {};
  for (const card of cards) {
    if (!card.dueDate) continue;
    const list = grouped[card.dueDate];
    if (list) list.push(card);
    else grouped[card.dueDate] = [card];
  }
  return grouped;
}

export function assigneeLoad(
  cards: CalendarCard[],
  assignees: Array<{ userId: string; displayName: string }>,
): {
  entries: Array<{ userId: string; displayName: string; count: number }>;
  unassignedCount: number;
} {
  const names = new Map(assignees.map((entry) => [entry.userId, entry.displayName]));
  const counts = new Map<string, number>();
  let unassignedCount = 0;
  for (const card of cards) {
    if (!card.assigneeUserIds.length) {
      unassignedCount += 1;
      continue;
    }
    for (const userId of new Set(card.assigneeUserIds)) {
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()]
    .map(([userId, count]) => ({
      userId,
      // 已離開 workspace 的成員不在目錄中，沿用既有慣例以短 ID 呈現。
      displayName: names.get(userId) ?? userId.slice(0, 8),
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.displayName.localeCompare(b.displayName, "zh-Hant") ||
        a.userId.localeCompare(b.userId),
    );
  return { entries, unassignedCount };
}

export function isOverdue(dueDate: string, today: string): boolean {
  return Boolean(dueDate) && dueDate < today;
}
