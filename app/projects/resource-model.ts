// 人力甘特圖的純函式排版模組（v1）。
//
// 這個模組是整個功能唯一的自動化行為防線：React 元件（Task 6）不寫單元測試，
// 所有排版計算（日期範圍、bar 裁切、lane 分配、超載偵測、分組）都留在這裡，
// 元件只負責把這裡算出來的結果畫出來。定位與寫法比照 app/projects/calendar-model.ts。
//
// 日期運算一律走 UTC：Date.parse(`${day}T00:00:00Z`) 加減 86_400_000 再格式化
// 回 YYYY-MM-DD，避免 `new Date(y, m, d)` 之類的本地建構子在非 UTC 時區環境下
// 讓跨月／跨年邊界位移一天。worker-sync/src/assignments.ts 的 inclusiveDays 用
// 同一套慣例。

import type { ResourceBar } from "./types";

const MS_PER_DAY = 86_400_000;

/** 把 `YYYY-MM-DD` 轉成該日 UTC 00:00 的時間戳。 */
function parseUtcDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** UTC 時間戳格式化回 `YYYY-MM-DD`；與 parseUtcDay 成對使用，中間不經過本地時區。 */
function formatUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** to 減 from 差幾天（皆為 `YYYY-MM-DD`）。 */
function diffDays(from: string, to: string): number {
  return Math.round((parseUtcDay(to) - parseUtcDay(from)) / MS_PER_DAY);
}

/** 含頭尾列出 from 到 to 之間每一天。to 早於 from 時回傳空陣列——Worker 端保證
 * 查詢窗 from <= to，但這裡不假設呼叫端一定守規矩，退化輸入給定義良好的結果
 * 而不是丟例外或跑出負索引。 */
export function dayRange(from: string, to: string): string[] {
  const start = parseUtcDay(from);
  const end = parseUtcDay(to);
  const days: string[] = [];
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    days.push(formatUtcDay(ms));
  }
  return days;
}

/** from／to 同時平移 deltaDays 天，區間長度不變；deltaDays 可為負（左移，翻到
 * 前一個查詢窗）。 */
export function shiftRange(
  from: string,
  to: string,
  deltaDays: number,
): { from: string; to: string } {
  const offset = deltaDays * MS_PER_DAY;
  return {
    from: formatUtcDay(parseUtcDay(from) + offset),
    to: formatUtcDay(parseUtcDay(to) + offset),
  };
}

/** 甘特圖預設查詢窗：自 start 起 14 天（含頭尾，所以終點是 start + 13 天）。 */
export function rangeFrom(start: string): { from: string; to: string } {
  return { from: start, to: formatUtcDay(parseUtcDay(start) + 13 * MS_PER_DAY) };
}

/**
 * 把一根 bar 換算成它在 `days` 查詢窗裡的格子座標：從第幾格開始、佔幾格。
 * 超出窗外的部分會被裁掉（clip），與窗完全不重疊時回傳 null。
 *
 * 前提：`days` 是像 dayRange() 產出的、按 UTC 升冪排列的連續日期陣列。
 * startIndex／span 用日期差直接算，不對 days 做陣列搜尋——如果呼叫端塞一個
 * 不連續的 days，算出來的格子座標會是錯的。
 */
export function barSpanInWindow(
  bar: { startDate: string; endDate: string },
  days: string[],
): { startIndex: number; span: number } | null {
  if (days.length === 0) return null;
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];
  if (bar.endDate < windowStart || bar.startDate > windowEnd) return null;
  const clippedStart = bar.startDate > windowStart ? bar.startDate : windowStart;
  const clippedEnd = bar.endDate < windowEnd ? bar.endDate : windowEnd;
  return {
    startIndex: diffDays(windowStart, clippedStart),
    span: diffDays(clippedStart, clippedEnd) + 1,
  };
}

/** packLanes 的排序鍵：startDate、endDate、cardId 皆為結構性欄位而非顯示文字，
 * 用純字串比較（非 localeCompare）——不需要語系排序規則，也不想讓排序結果受
 * ICU 版本影響。 */
function bySortKey(a: ResourceBar, b: ResourceBar): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  if (a.endDate !== b.endDate) return a.endDate < b.endDate ? -1 : 1;
  if (a.cardId !== b.cardId) return a.cardId < b.cardId ? -1 : 1;
  return 0;
}

/**
 * 貪婪排 lane：依 startDate、endDate、cardId 排序後，逐條由 lane 0 起找第一個
 * 「最後結束日 < 本條開始日」的 lane 塞進去；找不到就開新 lane。用 `<` 而非
 * `<=`：頭尾相接的兩根 bar（一根某天結束、下一根隔天開始）視為不重疊，可以
 * 共用同一個 lane。
 *
 * 排序鍵含 cardId 是為了決定性：Task 6 每次重繪都會呼叫這個函式，同一份資料
 * 不論輸入順序都必須排出同一個 lane 配置，否則畫面會跳動。唯一殘留、排序鍵
 * 排不開的情形——同一顆排序鍵完全相同（含 cardId）的兩根 bar——交給
 * Array.prototype.sort 的 stable sort 保留原始輸入順序；這只有在同一使用者
 * 同一張卡出現兩段 start/end 完全相同的投入期間時才會發生，屬理論上的退化
 * 情形，資料正常不會出現。
 */
export function packLanes(bars: ResourceBar[]): Array<{ bar: ResourceBar; lane: number }> {
  const sorted = [...bars].sort(bySortKey);
  const laneEnds: string[] = [];
  const result: Array<{ bar: ResourceBar; lane: number }> = [];
  for (const bar of sorted) {
    const lane = laneEnds.findIndex((end) => end < bar.startDate);
    if (lane === -1) {
      laneEnds.push(bar.endDate);
      result.push({ bar, lane: laneEnds.length - 1 });
    } else {
      laneEnds[lane] = bar.endDate;
      result.push({ bar, lane });
    }
  }
  return result;
}

/** `days` 窗內，每天同時有幾根 bar 重疊；只收錄重疊數 >= 2 的日期（真正
 * 「超載」的日子）。依 days 的順序逐一插入，結果的 Map 迭代順序天生遞增。 */
export function overloadedDays(bars: ResourceBar[], days: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const day of days) {
    let count = 0;
    for (const bar of bars) {
      if (bar.startDate <= day && day <= bar.endDate) count += 1;
    }
    if (count >= 2) result.set(day, count);
  }
  return result;
}

/** 依 userId 分組，組內維持輸入順序。 */
export function groupBarsByUser(bars: ResourceBar[]): Map<string, ResourceBar[]> {
  const grouped = new Map<string, ResourceBar[]>();
  for (const bar of bars) {
    const list = grouped.get(bar.userId);
    if (list) list.push(bar);
    else grouped.set(bar.userId, [bar]);
  }
  return grouped;
}
