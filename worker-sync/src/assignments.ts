import { resolveCalendarScope } from "./calendar";
import { json } from "./http";
import { requireMigrationComplete, type ApiContext } from "./projects";
import { RequestError, parseUuid } from "./validation";

/** 單次請求最多展開的看板數；超出時回應標記 boardsTruncated。 */
export const MAX_BOARDS = 50;
/** 甘特條上限；超出時回應標記 barsTruncated。 */
export const MAX_BARS = 2000;
/** 未排期清單上限；超出時回應標記 unscheduledTruncated。 */
export const MAX_UNSCHEDULED = 200;
/** D1 單一查詢的 bind 參數上限是 100，所有 IN 清單都以此分批
 *  （calendar.ts 目前未分批，屬既有 NextTasks P1 債務；本端點不重演）。 */
const CHUNK_SIZE = 50;
/** 查詢窗長上限，含頭尾。 */
const MAX_RANGE_DAYS = 31;

/** date-only 格式；只驗格式與粗略的月/日範圍，不是完整曆法驗證（例如仍會放行
 *  「2月30日」）。用於：(1) 查詢參數 from/to 的輸入驗證；(2) row → bar 轉換時的
 *  縱深防禦——worker-sync/src/boards.ts 寫入端的 DATE_ONLY 只驗
 *  /^\d{4}-\d{2}-\d{2}$/（不驗範圍），所以「2026-13-45」這種值可能已經入庫
 *  （Task 2 審查 minor，見 .superpowers/sdd/2026-08-13-resource-gantt-v1/progress.md）。
 *  SQL 對這類值只做字串比較，不會出錯，但會產生無意義的條子；用同一顆正則在
 *  轉換階段再篩一次，格式不符就跳過該筆，不讓它進 bars。這是縱深防禦，不是
 *  重複驗證——SQL 讀的是既存資料，可能早於任何一版寫入驗證。 */
const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const SERVICE_CLASSES = ["standard", "expedite", "fixedDate", "intangible"];

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** 含頭尾的天數；輸入已由 DATE_ONLY 驗過格式。 */
function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

type BarRow = {
  project_id: string;
  project_name: string;
  board_id: string;
  board_name: string;
  card_id: string;
  title: string;
  blocked: number | null;
  service_class: string | null;
  user_id: string | null;
  start_date: string | null;
  end_date: string | null;
};

type Bar = {
  userId: string;
  cardId: string;
  title: string;
  startDate: string;
  endDate: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
  blocked: boolean;
  serviceClass: string;
};

/** row → bar。userId 缺席（windows.type='object' 已在 SQL 端守門，理論上不會發生，
 *  但 D1 型別在 TS 層不透明，這裡 fail-closed 再驗一次）或 startDate／endDate
 *  未通過 DATE_ONLY 的縱深防禦檢查，直接跳過整筆，不讓它進 bars。 */
function toBar(row: BarRow): Bar | null {
  if (
    typeof row.user_id !== "string" || !row.user_id ||
    typeof row.start_date !== "string" || !DATE_ONLY.test(row.start_date) ||
    typeof row.end_date !== "string" || !DATE_ONLY.test(row.end_date)
  ) {
    return null;
  }
  const serviceClass = row.service_class && SERVICE_CLASSES.includes(row.service_class)
    ? row.service_class
    : "standard";
  return {
    userId: row.user_id,
    cardId: row.card_id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    projectId: row.project_id,
    projectName: row.project_name,
    boardId: row.board_id,
    boardName: row.board_name,
    blocked: Boolean(row.blocked),
    serviceClass,
  };
}

type AssignedCardRow = {
  project_id: string;
  project_name: string;
  board_id: string;
  board_name: string;
  card_id: string;
  title: string;
  assignee_ids: string | null;
  windows_json: string | null;
};

type UnscheduledItem = {
  cardId: string;
  title: string;
  userId: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
};

/** row 的 assigneeUserIds 內、windows_json 裡找不到對應 userId 的人 → 未排期。
 *  兩段 JSON.parse 都容錯：assignee_ids 解析失敗或非陣列 → 這張卡不產生任何未
 *  排期項；windows_json 解析失敗或非陣列 → 視為「沒有任何 window」，該卡全部
 *  指派人都算未排期（陣列內非物件或 userId 非字串的成員直接跳過，不判斷任何
 *  日期合法性——這裡只問「有沒有排期意圖」，不是「排期是否乾淨」，日期層級的
 *  縱深防禦只影響 bars，見 toBar）。 */
function unscheduledFromRow(row: AssignedCardRow): UnscheduledItem[] {
  let assigneeIds: string[] = [];
  try {
    const parsed = JSON.parse(row.assignee_ids ?? "null") as unknown;
    if (Array.isArray(parsed)) {
      assigneeIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    assigneeIds = [];
  }
  if (!assigneeIds.length) return [];

  const scheduledUserIds = new Set<string>();
  try {
    const parsed = JSON.parse(row.windows_json ?? "null") as unknown;
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const userId = (entry as Record<string, unknown>).userId;
        if (typeof userId === "string") scheduledUserIds.add(userId);
      }
    }
  } catch {
    // 解析失敗＝沒有任何 window，scheduledUserIds 維持空集合。
  }

  return assigneeIds
    .filter((userId) => !scheduledUserIds.has(userId))
    .map((userId) => ({
      cardId: row.card_id,
      title: row.title,
      userId,
      projectId: row.project_id,
      projectName: row.project_name,
      boardId: row.board_id,
      boardName: row.board_name,
    }));
}

/** 兩層 json_each 展開卡片與投入期間。
 *
 *  與 brief 原始 SQL 的出入（見任務報告 Step 1／Step 6 的實測記錄，兩者結論不同，
 *  以下以實測為準——兩處出入都是拿實際 D1 測試跑出 500 才發現，node:sqlite 的
 *  Step 1 探針沒能重現）：
 *
 *  1. brief 原始 barQuery 只在 windows 的 JOIN 用 CASE 包住 json_each 的參數，
 *     WHERE 沒有 `cards.type = 'object'`。實測發現這樣不夠：即使 windows 那層
 *     join 因為 CASE 命中 NULL 而對非物件卡片產生 0 筆、把該卡從最終輸出中排除，
 *     SELECT 清單裡沒有 CASE 保護的 `json_extract(cards.value, '$.title')` 等呼叫
 *     仍會在 D1 的實際執行期間對該列求值並拋出 malformed JSON——JOIN 消去並不
 *     保證上層 SELECT 運算式不會先被求值。加回 `cards.type = 'object'`（WHERE，
 *     與 assignedCardQuery 及 calendar.ts 的既有寫法一致）後，對照測試證實這一條
 *     WHERE 守門本身就足以讓整條查詢在 scalar 卡片上安全跳過，CASE 反而是多餘的
 *     ——但仍保留 CASE，理由見下方第 3 點。
 *  2. CASE 只判斷 `cards.type = 'object'`（卡片本身是不是物件），沒有判斷
 *     `$.assignmentWindows` 這個欄位本身的型別。卡片是合法物件、但
 *     `assignmentWindows` 欄位本身是 scalar（例如 `"assignmentWindows": "x"`）
 *     時，`cards.type='object'` 為真，CASE 的 THEN 分支執行，
 *     `json_extract(cards.value, '$.assignmentWindows')` 老實地把這個 scalar
 *     抽出來，然後 `json_each(該 scalar)` 照樣拋 malformed JSON——這正是 Step 1
 *     探針原本想模擬、但探針裡的卡片本身就是 scalar，沒測到「卡片是物件、
 *     欄位本身是 scalar」這個更深一層的形狀。修法是在 CASE 條件多加
 *     `json_type(cards.value, '$.assignmentWindows') = 'array'`——
 *     `json_type` 對缺席鍵回傳 SQL NULL（v7 舊卡沒有這個欄位，CASE 條件的
 *     AND 鏈中混入 NULL 使整個條件非真，THEN 不執行，行為與「明確判斷缺席」
 *     一致，不需要另外處理 IS NULL）、對 scalar 回傳 'text'/'integer'/…
 *     （非 'array'，THEN 不執行）、對真正的陣列回傳 'array'（THEN 執行）。
 *  3. 加了第 1 點的 WHERE 守門後，CASE 對「卡片本身是 scalar」這個情境確實是
 *     多餘的（WHERE 已經擋下），但拿掉 CASE 不會讓程式碼更簡單，反而會失去
 *     「不依賴查詢規劃器求值順序」的建構保證，且會讓 Step 7 的 mutation
 *     測試沒有東西可以驗證。故 CASE 保留，且必須繼續帶第 2 點的 json_type
 *     檢查——那一層防護不是 WHERE cards.type='object' 的重複，是完全獨立的
 *     另一種畸形資料。 */
function barQuery(projectPlaceholders: string): string {
  return `SELECT projects.id AS project_id, projects.name AS project_name,
                 boards.id AS board_id, boards.name AS board_name,
                 cards.key AS card_id,
                 json_extract(cards.value, '$.title') AS title,
                 json_extract(cards.value, '$.blocked') AS blocked,
                 json_extract(cards.value, '$.serviceClass') AS service_class,
                 json_extract(windows.value, '$.userId') AS user_id,
                 json_extract(windows.value, '$.startDate') AS start_date,
                 json_extract(windows.value, '$.endDate') AS end_date
          FROM boards
          INNER JOIN projects ON projects.id = boards.project_id
          JOIN json_each(json_extract(boards.data, '$.cards')) AS cards
          JOIN json_each(CASE WHEN cards.type = 'object'
                AND json_type(cards.value, '$.assignmentWindows') = 'array'
                THEN json_extract(cards.value, '$.assignmentWindows') END) AS windows
          WHERE boards.id IN (
                  SELECT boards.id FROM boards
                  WHERE boards.status = 'active'
                    AND boards.project_id IN (${projectPlaceholders})
                  ORDER BY boards.updated_at DESC, boards.id DESC
                  LIMIT ${MAX_BOARDS}
                )
            AND projects.status = 'active'
            AND cards.type = 'object'
            AND windows.type = 'object'
            AND json_extract(cards.value, '$.completedAt') IS NULL
            AND json_extract(windows.value, '$.startDate') <= ?
            AND json_extract(windows.value, '$.endDate') >= ?
          LIMIT ${MAX_BARS + 1}`;
}

/** 只展開 $.cards 一層；window 比對挪到 Worker 內做（見 unscheduledFromRow），
 *  避免第三層 json_each。
 *
 *  LIMIT 用 MAX_UNSCHEDULED*10+1，不是 brief 原始程式碼片段裡示範的
 *  MAX_UNSCHEDULED*10——brief 的散文說明本身要求「+1」（見 brief 原文：
 *  「原始列數達到這個 LIMIT，unscheduledTruncated 一律為 true」，這需要能
 *  區分「剛好等於視覺上限」與「原始資料被截斷」，只有 +1 才做得到），程式碼
 *  片段少了 +1 判斷是 brief 本身的落差，這裡採信散文與控制者的裁決。
 *  一張卡可能有多位指派人卻只有少數缺期間，所以原始列數必須大於未排期上限
 *  才夠篩。 */
function assignedCardQuery(projectPlaceholders: string): string {
  return `SELECT projects.id AS project_id, projects.name AS project_name,
                 boards.id AS board_id, boards.name AS board_name,
                 cards.key AS card_id,
                 json_extract(cards.value, '$.title') AS title,
                 json_extract(cards.value, '$.assigneeUserIds') AS assignee_ids,
                 json_extract(cards.value, '$.assignmentWindows') AS windows_json
          FROM boards
          INNER JOIN projects ON projects.id = boards.project_id
          JOIN json_each(json_extract(boards.data, '$.cards')) AS cards
          WHERE boards.id IN (
                  SELECT boards.id FROM boards
                  WHERE boards.status = 'active'
                    AND boards.project_id IN (${projectPlaceholders})
                  ORDER BY boards.updated_at DESC, boards.id DESC
                  LIMIT ${MAX_BOARDS}
                )
            AND projects.status = 'active'
            AND cards.type = 'object'
            AND json_extract(cards.value, '$.completedAt') IS NULL
          LIMIT ${MAX_UNSCHEDULED * 10 + 1}`;
}

type Person = { userId: string; displayName: string };

function sortPeople(people: Person[]): Person[] {
  return [...people].sort((a, b) =>
    a.displayName.localeCompare(b.displayName) || a.userId.localeCompare(b.userId));
}

/** 可見專案的全體成員（含 owner／member／viewer），分批查詢後以 Map 去重
 *  （單一 chunk 內的 DISTINCT 不會跨 chunk 生效，仍需在這裡合併）。 */
async function fetchCurrentMembers(
  database: D1Database,
  projectIds: string[],
): Promise<Map<string, string>> {
  const members = new Map<string, string>();
  for (const group of chunk(projectIds, CHUNK_SIZE)) {
    const placeholders = group.map(() => "?").join(", ");
    const result = await database.prepare(
      `SELECT DISTINCT project_members.user_id AS user_id,
              user_accounts.display_name AS display_name
       FROM project_members
       INNER JOIN user_accounts ON user_accounts.id = project_members.user_id
       WHERE project_members.project_id IN (${placeholders})`,
    ).bind(...group).all<{ user_id: string; display_name: string }>();
    for (const row of result.results) members.set(row.user_id, row.display_name);
  }
  return members;
}

/** 已離開專案但指派仍保留者的姓名查詢；查不到時由呼叫端補空字串。 */
async function fetchDisplayNames(
  database: D1Database,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const group of chunk(userIds, CHUNK_SIZE)) {
    const placeholders = group.map(() => "?").join(", ");
    const result = await database.prepare(
      `SELECT id, display_name FROM user_accounts WHERE id IN (${placeholders})`,
    ).bind(...group).all<{ id: string; display_name: string }>();
    for (const row of result.results) names.set(row.id, row.display_name);
  }
  return names;
}

export async function handleAssignmentsRequest(
  context: ApiContext,
): Promise<Response | null> {
  const url = new URL(context.request.url);
  if (url.pathname !== "/assignments") return null;
  if (context.request.method !== "GET") return null;
  await requireMigrationComplete(context.env.DB);

  const workspaceId = parseUuid(url.searchParams.get("workspaceId"), "workspace_id");
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || from > to) {
    throw new RequestError(400, "invalid_range");
  }
  if (inclusiveDays(from, to) > MAX_RANGE_DAYS) {
    throw new RequestError(400, "invalid_range");
  }

  const scope = await resolveCalendarScope(context.env.DB, context.user.id, workspaceId);
  if (!scope.projectIds.length) {
    return json(200, {
      from, to, scope: scope.kind,
      people: [], bars: [], unscheduled: [],
      barsTruncated: false, unscheduledTruncated: false, boardsTruncated: false,
      requestId: context.requestId,
    }, context.requestId);
  }

  const database = context.env.DB;
  const projectGroups = chunk(scope.projectIds, CHUNK_SIZE);

  let boardCount = 0;
  const bars: Bar[] = [];
  let barsRawHitLimit = false;
  const unscheduledAll: UnscheduledItem[] = [];
  let unscheduledRawHitLimit = false;

  for (const group of projectGroups) {
    const placeholders = group.map(() => "?").join(", ");

    const countRow = await database.prepare(
      `SELECT COUNT(*) AS n FROM boards
       WHERE boards.status = 'active' AND boards.project_id IN (${placeholders})`,
    ).bind(...group).first<number>("n") ?? 0;
    boardCount += countRow;

    const barResult = await database.prepare(barQuery(placeholders))
      .bind(...group, to, from)
      .all<BarRow>();
    // 每個 chunk 的 SQL LIMIT 是 MAX_BARS+1；若剛好頂到，代表這個 chunk 底下可能
    // 還有更多 bar 存在，全域截斷旗標不能只看「篩完後跨 chunk 合併的筆數」，見
    // toBar 的縱深防禦可能讓某個 chunk 篩後筆數低於其原始 LIMIT。
    if (barResult.results.length === MAX_BARS + 1) barsRawHitLimit = true;
    for (const row of barResult.results) {
      const bar = toBar(row);
      if (bar) bars.push(bar);
    }

    const assignedResult = await database.prepare(assignedCardQuery(placeholders))
      .bind(...group)
      .all<AssignedCardRow>();
    if (assignedResult.results.length === MAX_UNSCHEDULED * 10 + 1) unscheduledRawHitLimit = true;
    for (const row of assignedResult.results) {
      unscheduledAll.push(...unscheduledFromRow(row));
    }
  }

  bars.sort((a, b) =>
    a.startDate.localeCompare(b.startDate) ||
    a.projectName.localeCompare(b.projectName) ||
    a.title.localeCompare(b.title) ||
    a.userId.localeCompare(b.userId));
  const barsTruncated = barsRawHitLimit || bars.length > MAX_BARS;
  const trimmedBars = bars.slice(0, MAX_BARS);

  unscheduledAll.sort((a, b) =>
    a.projectName.localeCompare(b.projectName) ||
    a.title.localeCompare(b.title) ||
    a.userId.localeCompare(b.userId));
  const unscheduledTruncated = unscheduledRawHitLimit || unscheduledAll.length > MAX_UNSCHEDULED;
  const trimmedUnscheduled = unscheduledAll.slice(0, MAX_UNSCHEDULED);

  const currentMembersMap = await fetchCurrentMembers(database, scope.projectIds);
  const currentMembers = sortPeople(
    [...currentMembersMap].map(([userId, displayName]) => ({ userId, displayName })),
  );
  // 只用「實際會回傳的」bars/unscheduled 判定誰是已離開成員：被截斷掉、根本不會
  // 顯示的條子沒有理由讓對應的人多長出一個 people 列。
  const involvedUserIds = [...new Set([
    ...trimmedBars.map((bar) => bar.userId),
    ...trimmedUnscheduled.map((item) => item.userId),
  ])];
  const departedIds = involvedUserIds.filter((id) => !currentMembersMap.has(id));
  const departedNames = departedIds.length
    ? await fetchDisplayNames(database, departedIds)
    : new Map<string, string>();
  const departed = sortPeople(
    departedIds.map((userId) => ({ userId, displayName: departedNames.get(userId) ?? "" })),
  );
  const people = [...currentMembers, ...departed];

  return json(200, {
    from,
    to,
    scope: scope.kind,
    people,
    bars: trimmedBars,
    unscheduled: trimmedUnscheduled,
    barsTruncated,
    unscheduledTruncated,
    boardsTruncated: boardCount > MAX_BOARDS,
    requestId: context.requestId,
  }, context.requestId);
}
