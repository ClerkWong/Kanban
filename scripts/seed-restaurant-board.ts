/**
 * 以餐廳營運任務填入指定 Board（staging 專用示範資料）。
 *
 * 設計要點：
 * - 保留目標 Board 既有的欄位結構（id／標題／WIP）與 settings，只替換 labels 與 cards。
 *   欄位 id 不可更動——`done` 是系統的完成欄身分，改了會破壞 completedAt 與流動報表。
 * - 以專案自身的 `addCard`／`serializeBoard` 建構，讓 `normalizeBoard` 保證 schema v7
 *   不變量（含加急置頂、卡片歸屬唯一）。不手寫 JSON。
 * - 只輸出一份 UPDATE SQL 檔，不直接寫入；SQL 帶 `WHERE revision = <讀到的值>`，
 *   併發寫入時不會靜默覆蓋。
 * - 直接寫 D1 會繞過 Worker 驗證與 Activity Log，因此僅限 staging 示範資料使用。
 *
 * 用法：
 *   pnpm exec tsx scripts/seed-restaurant-board.ts <boardId> > /path/to/seed.sql
 *   wrangler d1 execute kanban-sync-staging --remote --env staging \
 *     -c worker-sync/wrangler.jsonc --file /path/to/seed.sql
 */
import { execFileSync } from "node:child_process";
import {
  addCard,
  assertBoardInvariants,
  serializeBoard,
  type BoardState,
  type Card,
  type Label,
  type ServiceClass,
} from "../app/board-model";

const OWNER_LIDDLE = "a14c7f5d-4c2e-4be2-8896-07652625d722";
const OWNER_BOSS = "553bec70-b707-449e-8f8c-b6bfae54ee48";
const MEMBER_DAVID = "708eea01-09c1-4c33-a3b3-71ebba5dcf03";

const RESTAURANT_LABELS: Label[] = [
  { id: "front", name: "外場", color: "#5b7cfa" },
  { id: "kitchen", name: "內場", color: "#0f9f8f" },
  { id: "purchase", name: "採購", color: "#d46b08" },
  { id: "cleaning", name: "清潔", color: "#7a4cc2" },
  { id: "equipment", name: "設備", color: "#c24164" },
];

type SeedCard = {
  columnId: string;
  title: string;
  description: string;
  labelIds: string[];
  priority: Card["priority"];
  serviceClass: ServiceClass;
  /** 進入該欄位距今的天數；用來展示卡面老化的三個等級。 */
  daysInColumn: number;
  dueInDays?: number;
  assigneeUserIds?: string[];
  blockedReason?: string;
  checklist?: string[];
  /** 只有完成欄的卡片需要：距今幾天前開工，用來讓 Cycle Time 有值。 */
  startedDaysAgo?: number;
};

function iso(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
}

function dateOnly(now: Date, offsetDays: number): string {
  const target = new Date(now.getTime() + offsetDays * 86_400_000);
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${month}-${day}`;
}

/** 欄位 id 由目標 Board 的實際結構決定，這裡以標題對應。 */
function seedCards(columnIdByTitle: Map<string, string>): SeedCard[] {
  const todo = columnIdByTitle.get("待辦") ?? "todo";
  const morning = columnIdByTitle.get("早班") ?? "doing";
  const noon = columnIdByTitle.get("午班") ?? "review";
  const evening = columnIdByTitle.get("晚班") ?? "doing";
  const night = columnIdByTitle.get("大夜班") ?? "doing";
  const done = columnIdByTitle.get("完成") ?? "done";

  return [
    // 待辦：尚未排入班別的工作池。
    {
      columnId: todo,
      title: "冷凍櫃異音待維修",
      description: "壓縮機間歇異音，已請兩家廠商報價；停機前不可存放高單價食材。",
      labelIds: ["equipment"],
      priority: "high",
      serviceClass: "expedite",
      daysInColumn: 2,
      blockedReason: "等待廠商回覆報價與到場時間",
      assigneeUserIds: [OWNER_BOSS],
    },
    {
      columnId: todo,
      title: "中秋連假人力規劃",
      description: "三天連假預估來客成長四成，需先確認外場與內場排班與加班意願。",
      labelIds: ["front", "kitchen"],
      priority: "high",
      serviceClass: "fixedDate",
      daysInColumn: 5,
      dueInDays: 9,
    },
    {
      columnId: todo,
      title: "更新季節菜單價目表",
      description: "秋季食材換季，重算成本並更新店內立牌與外送平台價格。",
      labelIds: ["kitchen"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 1,
      checklist: ["重算食材成本", "更新店內立牌", "同步外送平台"],
    },
    {
      columnId: todo,
      title: "招募假日兼職外場",
      description: "週末尖峰缺兩名外場，張貼職缺並安排面談時段。",
      labelIds: ["front"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 3,
    },
    {
      columnId: todo,
      title: "檢視店內動線與候位區",
      description: "尖峰時段候位影響出餐通道，觀察一週後提出調整建議。",
      labelIds: ["front"],
      priority: "low",
      serviceClass: "intangible",
      daysInColumn: 8,
    },

    // 早班：開店前置。
    {
      columnId: morning,
      title: "開店前備料與熬製湯底",
      description: "依前日訂位量備料；湯底需在十點前完成試味。",
      labelIds: ["kitchen"],
      priority: "high",
      serviceClass: "standard",
      daysInColumn: 0,
      assigneeUserIds: [MEMBER_DAVID],
      checklist: ["蔬果洗切", "湯底熬製", "試味與調整"],
    },
    {
      columnId: morning,
      title: "生鮮驗收與登帳",
      description: "核對供應商到貨數量與溫層，異常品項當場退貨並記錄。",
      labelIds: ["purchase"],
      priority: "high",
      serviceClass: "standard",
      daysInColumn: 0,
      assigneeUserIds: [OWNER_BOSS],
    },
    {
      columnId: morning,
      title: "咖啡機清洗與試杯",
      description: "每日開機沖洗管路，試杯確認萃取時間落在標準區間。",
      labelIds: ["equipment"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 1,
    },

    // 午班：尖峰運轉。
    {
      columnId: noon,
      title: "午市套餐備品盤點",
      description: "盤點餐盒與餐具存量，不足時當日補訂。",
      labelIds: ["kitchen", "purchase"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 4,
      assigneeUserIds: [MEMBER_DAVID],
    },
    {
      columnId: noon,
      title: "外送平台訂單對帳",
      description: "比對平台後台與收銀機金額，差異需當日回報平台客服。",
      labelIds: ["front"],
      priority: "medium",
      serviceClass: "fixedDate",
      daysInColumn: 1,
      dueInDays: 0,
    },

    // 晚班。
    {
      columnId: evening,
      title: "晚市訂位確認與帶位表",
      description: "電話確認當晚訂位，安排併桌與帶位順序。",
      labelIds: ["front"],
      priority: "high",
      serviceClass: "standard",
      daysInColumn: 0,
      assigneeUserIds: [MEMBER_DAVID],
    },
    {
      columnId: evening,
      title: "酒水庫存補充",
      description: "補足吧檯冰櫃與常溫酒架，記錄當日耗用。",
      labelIds: ["purchase"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 2,
    },

    // 大夜班：打烊與隔日準備。
    {
      columnId: night,
      title: "打烊清潔與地板消毒",
      description: "廚房排水溝、油煙罩表面與外場地板；完成後拍照回報。",
      labelIds: ["cleaning"],
      priority: "high",
      serviceClass: "standard",
      daysInColumn: 0,
    },
    {
      columnId: night,
      title: "隔日食材解凍準備",
      description: "依隔日預估量移入冷藏解凍，標註解凍時間。",
      labelIds: ["kitchen"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 0,
    },
    {
      columnId: night,
      title: "日結帳與現金核對",
      description: "結算現金、信用卡與行動支付，差異超過五十元需說明。",
      labelIds: ["front"],
      priority: "high",
      serviceClass: "fixedDate",
      daysInColumn: 9,
      dueInDays: -1,
      assigneeUserIds: [OWNER_LIDDLE],
    },

    // 完成：讓流動報表有實際的 Cycle Time 與阻塞資料。
    {
      columnId: done,
      title: "上週油煙罩深度清洗",
      description: "外包廠商完成拆洗，濾網已更換並留存驗收照片。",
      labelIds: ["cleaning", "equipment"],
      priority: "medium",
      serviceClass: "standard",
      daysInColumn: 2,
      startedDaysAgo: 6,
      assigneeUserIds: [OWNER_BOSS],
    },
  ];
}

function readBoardRow(boardId: string): { data: string; revision: number } {
  const raw = execFileSync(
    "pnpm",
    [
      "exec", "wrangler", "d1", "execute", "kanban-sync-staging",
      "--remote", "--env", "staging", "-c", "worker-sync/wrangler.jsonc",
      "--json", "--command",
      `SELECT data, revision FROM boards WHERE id = '${boardId}'`,
    ],
    { encoding: "utf8", env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" } },
  );
  const start = raw.indexOf("[");
  if (start < 0) throw new Error("wrangler 未回傳 JSON");
  const parsed = JSON.parse(raw.slice(start)) as Array<{
    results: Array<{ data: string; revision: number }>;
  }>;
  const row = parsed[0]?.results?.[0];
  if (!row) throw new Error(`找不到 board ${boardId}`);
  return row;
}

function main(): void {
  const boardId = process.argv[2];
  if (!boardId) throw new Error("用法：tsx scripts/seed-restaurant-board.ts <boardId>");

  const row = readBoardRow(boardId);
  const existing = JSON.parse(row.data) as BoardState;
  const columnIdByTitle = new Map(
    existing.columns.map((column) => [column.title, column.id]),
  );

  const now = new Date();
  // 保留欄位結構與 settings，清空卡片後重建。
  let board: BoardState = {
    ...existing,
    labels: RESTAURANT_LABELS,
    cards: {},
    deletedCards: {},
    columns: existing.columns.map((column) => ({ ...column, cardIds: [] })),
  };

  for (const seed of seedCards(columnIdByTitle)) {
    const enteredAt = iso(now, seed.daysInColumn);
    const input: Partial<Card> & Pick<Card, "title"> = {
      title: seed.title,
      description: seed.description,
      priority: seed.priority,
      labelIds: seed.labelIds,
      serviceClass: seed.serviceClass,
      dueDate: seed.dueInDays === undefined ? "" : dateOnly(now, seed.dueInDays),
      assigneeUserIds: seed.assigneeUserIds ?? [],
      columnEnteredAt: enteredAt,
      createdAt: iso(now, seed.daysInColumn + 1),
      checklist: (seed.checklist ?? []).map((text, index) => ({
        id: `${seed.title}-check-${index + 1}`,
        text,
        done: false,
      })),
      blocked: Boolean(seed.blockedReason),
      blockedReason: seed.blockedReason ?? "",
      blockedAt: seed.blockedReason ? enteredAt : null,
    };

    // 非第一欄的卡片需要 startedAt 才有 Cycle Time；完成欄另需 completedAt。
    const isTodo = seed.columnId === board.columns[0]?.id;
    if (!isTodo) {
      input.startedAt = iso(now, seed.startedDaysAgo ?? seed.daysInColumn + 1);
    }
    if (seed.startedDaysAgo !== undefined) {
      input.completedAt = enteredAt;
    }

    board = addCard(board, seed.columnId, input, now);
  }

  assertBoardInvariants(board);
  const serialized = serializeBoard(board);
  const literal = serialized.replace(/'/g, "''");
  const updatedAt = now.toISOString();

  process.stdout.write(
    `-- 覓夜餐廳示範資料；產生於 ${updatedAt}\n` +
      `UPDATE boards SET data = '${literal}', revision = ${row.revision + 1}, ` +
      `updated_at = '${updatedAt}' WHERE id = '${boardId}' AND revision = ${row.revision};\n`,
  );
  process.stderr.write(
    `已產生 SQL：board ${boardId}，revision ${row.revision} → ${row.revision + 1}，` +
      `${Object.keys(board.cards).length} 張卡片\n`,
  );
}

main();
