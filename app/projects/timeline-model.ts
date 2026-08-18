// 看板時間軸魚骨圖的純函式排版模組（v1）。
//
// 這個模組是整個功能唯一的自動化行為防線：React 元件（Task 5 的
// BoardTimeline）沒有單元測試，所有排版計算——開工日換算、天數差、父子
// 分組、頂層交錯、貪婪分列——都留在這裡，元件只負責把這裡算出來的結果畫
// 出來。定位與寫法比照 app/projects/calendar-model.ts 與
// app/projects/resource-model.ts。
//
// 這個模組會被元件直接呼叫，不能假設呼叫端一定先跑過 board-model.ts 的
// normalizeBoard。normalizeBoard 保證正式資料無環、無孤兒、深度不超過
// MAX_CARD_DEPTH，但這裡的 buildForest／layoutTimeline 仍必須對含環、含
// 孤兒的輸入定義良好（不拋錯、不無限遞迴）——這是刻意的縱深防禦，不是重複
// 勞動。

import type { Card } from "../board-model";

const MS_PER_DAY = 86_400_000;

/** 離散縮放級距，單位 px/日；UI 的縮放選單直接列舉這個陣列。 */
export const ZOOM_LEVELS = [8, 12, 16, 24, 32] as const;
export const DEFAULT_PX_PER_DAY = 16;
/** 卡面固定寬度（px）。貪婪分列的碰撞判定、主骨寬度換算都以此為準。 */
export const TIMELINE_CARD_WIDTH = 180;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 把完整 ISO 時間戳換算成檢視者本地時區的日期（`YYYY-MM-DD`）。
 *
 * 刻意用 `getFullYear`／`getMonth`／`getDate`（本地時區取值），**不用**
 * `toISOString().slice(0, 10)`（UTC 日）——後者在 UTC 之後的時區（例如台灣
 * UTC+8）會把深夜開工的卡片往前推一天，在 UTC 之前的時區則往後推，讓卡片
 * 在魚骨圖上整體偏移一天。管理者讀的是自己日曆上的「哪一天開工」，這也是
 * calendar-model.ts 的 localDateString 與看板既有逾期判斷同一慣例。
 */
export function startedDay(startedAt: string): string {
  const date = new Date(startedAt);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `day` 減 `from` 差幾天，兩者皆為 `YYYY-MM-DD`。刻意走 UTC（`Date.parse`
 * 補上 `Z` 尾碼）——兩個 date-only 字串本身已經代表「哪一天」，相減只是
 * 曆法算術，跟檢視者時區無關；解析成 UTC 純粹是為了避開本地時區的 DST
 * 位移，不是要重新引入時區問題。
 *
 * resource-model.ts 內部有語意相同的私有函式 `diffDays`（未 export），這裡
 * 刻意「各自持有」而不改動那個模組去 import 重用：
 *  1. `diffDays` 沒有 export，重用得先擴大 resource-model.ts 的公開介面，
 *     讓魚骨圖與甘特圖這兩個目前彼此獨立的檢視模組因此產生耦合——兩者除了
 *     共用 board-model.ts／types.ts 外互不相依，不想為了三行算術打破這點；
 *  2. 這個運算是零依賴的日期算術，複製成本遠低於耦合成本。
 * 如果之後出現第三個模組要用到同一運算，才值得把它抽到兩邊都 import 的
 * 共用位置；現在只有兩個，抽出來是提前優化。
 */
export function dayOffset(from: string, day: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${day}T00:00:00Z`);
  return Math.round((end - start) / MS_PER_DAY);
}

/** 型別縮窄：`startedAt` 非 null 的卡片。給 filter 用，讓後續存取
 *  `card.startedAt` 不需要再處理 null 分支。 */
function isStartedCard(card: Card): card is Card & { startedAt: string } {
  return card.startedAt !== null;
}

/**
 * 已開工卡片的時間軸範圍：`from` 取最早的開工日，`to` 取「今天」與最晚開工
 * 日兩者較晚的一個——開工日可能排在今天之後（提前建卡、排期後才真正開工），
 * 此時主骨要畫到那一天，不能被今天截斷。沒有任何已開工卡片時回 `null`，
 * 呼叫端據此顯示「還沒有任務開工」的提示，並仍列出未啟動池。
 */
export function timelineBounds(
  cards: Card[],
  today: string,
): { from: string; to: string } | null {
  let from: string | null = null;
  let to = today;
  for (const card of cards.filter(isStartedCard)) {
    const day = startedDay(card.startedAt);
    if (from === null || day < from) from = day;
    if (day > to) to = day;
  }
  return from === null ? null : { from, to };
}

/**
 * 由 `parentCardId` 建出樹狀結構：`roots` 是頂層卡片 id（依輸入順序），
 * `childrenOf` 是每張卡片 id 對應的直接子卡 id 清單。
 *
 * 一次線性掃描分組，不對任何卡片呼叫 board-model.ts 的
 * `descendantCardIds`——那個函式內部對全部卡片做迴圈，逐卡呼叫在這裡會疊成
 * O(n³)；這裡改成一次建表是 O(n)。
 *
 * 三種壞連結一律視為「頂層」，不拋錯也不試圖修復環，因為這個函式會被元件
 * 直接呼叫，不能假設呼叫端一定先跑過 normalizeBoard：
 *  - `parentCardId` 指向自己；
 *  - `parentCardId` 指向不在這份 `cards` 裡的 id（孤兒、已刪除，或呼叫端
 *    只傳了子集——例如 `layoutTimeline` 只傳已開工卡片時，未開工的父卡就
 *    不在集內，這張子卡因此自然被當成頂層，剛好對應魚骨圖「父卡未開工時
 *    子卡直接接主骨」的規則）；
 *  - 成環——環上每張卡都指向一個「存在且不是自己」的卡，所以不會被上面兩條
 *    規則攔下而變成頂層。但這個函式本身只做一次 for 迴圈分組，沒有任何一步
 *    沿 `parentCardId` 走訪，環不會讓它卡住或炸掉；環造成的唯一後果是
 *    `roots` 少了本該存在的入口，環上的卡片仍全部留在 `childrenOf` 的某個
 *    value 陣列裡，不會憑空消失（見對應測試）。呼叫端若要走訪這棵樹，需要
 *    自己對「環跟任何頂層都不連通」這件事做二次防禦（`layoutTimeline` 有做）。
 */
export function buildForest(
  cards: Card[],
): { roots: string[]; childrenOf: Map<string, string[]> } {
  const ids = new Set(cards.map((card) => card.id));
  const roots: string[] = [];
  const childrenOf = new Map<string, string[]>();
  for (const card of cards) {
    const parentId = card.parentCardId;
    const hasValidParent = parentId !== null && parentId !== card.id && ids.has(parentId);
    if (!hasValidParent) {
      roots.push(card.id);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(card.id);
    else childrenOf.set(parentId, [card.id]);
  }
  return { roots, childrenOf };
}

/** 尚未開工的卡片，依 `createdAt` 再 `id` 排序（純字串比較——ISO 字串與 id
 *  皆為結構性欄位而非顯示文字，不需要語系排序規則）。給主骨左端的未啟動池。 */
export function unstartedCards(cards: Card[]): Card[] {
  return cards
    .filter((card) => card.startedAt === null)
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    });
}

export type TimelineNode = {
  cardId: string;
  x: number;
  side: "top" | "bottom";
  row: number;
};

type Side = TimelineNode["side"];

/** 依 `(x, cardId)` 排序後偶數指派 `top`、奇數指派 `bottom`，寫入 `sideOf`。
 *  排序鍵含 `cardId`（全域唯一）湊成全序，同一份輸入永遠交錯出同一個結果。 */
function interleaveSides(
  ids: string[],
  xOf: Map<string, number>,
  sideOf: Map<string, Side>,
): void {
  const ordered = [...ids].sort((left, right) => {
    // 呼叫端（layoutTimeline）保證傳進來的每個 id 都在 xOf 裡：roots 與
    // leftover 都是從建出 xOf 的同一份已開工卡片清單取出的 id。?? 0 只是
    // 讓型別成立，不是真的會走到的分支。
    const diff = (xOf.get(left) ?? 0) - (xOf.get(right) ?? 0);
    if (diff !== 0) return diff;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  ordered.forEach((id, index) => {
    sideOf.set(id, index % 2 === 0 ? "top" : "bottom");
  });
}

/** 同一側內依 `(x, cardId)` 排序，貪婪分列：放進第一個「該列最後一張卡的
 *  右緣（`x + TIMELINE_CARD_WIDTH`）不超過本卡 `x`」的列，找不到就開新列。
 *  做法比照 resource-model.ts 的 `packLanes`，差別只在碰撞判定用固定卡寬，
 *  不是日期區間。 */
function packRows(ids: string[], xOf: Map<string, number>): Map<string, number> {
  const ordered = [...ids].sort((left, right) => {
    const diff = (xOf.get(left) ?? 0) - (xOf.get(right) ?? 0);
    if (diff !== 0) return diff;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const rowRightEdges: number[] = [];
  const rowOf = new Map<string, number>();
  for (const id of ordered) {
    const x = xOf.get(id) ?? 0;
    const row = rowRightEdges.findIndex((rightEdge) => rightEdge <= x);
    if (row === -1) {
      rowRightEdges.push(x + TIMELINE_CARD_WIDTH);
      rowOf.set(id, rowRightEdges.length - 1);
    } else {
      rowRightEdges[row] = x + TIMELINE_CARD_WIDTH;
      rowOf.set(id, row);
    }
  }
  return rowOf;
}

/**
 * 魚骨圖排版。只有已開工的卡片（`startedAt` 非空）會出現在結果裡；未開工
 * 的卡片屬於未啟動池（見 `unstartedCards`），不佔時間軸位置。
 *
 * 演算法：
 *  1. 為每張已開工卡片算出 `x = dayOffset(bounds.from, 該卡開工日) * pxPerDay`。
 *  2. 對「已開工卡片」這個子集呼叫 `buildForest`——子卡的父卡若未開工（不在
 *     這個子集內），會被 `buildForest` 的孤兒規則自動視為頂層。這正好對應
 *     規格「父卡未開工時子卡直接接主骨」的視覺規則，不需要另外特判。
 *  3. 頂層卡依 `(x, cardId)` 排序後交錯指派 `side`；子卡沿樹往下走訪沿用
 *     父卡的 `side`。每張卡只有一個 `parentCardId`，`buildForest` 建出的樹
 *     不可能有節點被兩個父節點同時收作子節點，從頂層出發的走訪本身不可能
 *     碰到環（環一定跟任何頂層不連通，見 `buildForest` 的註解）；仍加一層
 *     `visited` 防禦，理由與 board-model.ts 的 `cardDepth`／`subtreeHeight`
 *     相同：不假設這個不變量永遠成立。
 *  4. 殘餘：只有在「已開工卡片之間自己形成環」時才會發生（環與掛在環下的
 *     子孫都跟任何頂層不連通，走訪碰不到）——正常資料不會出現，
 *     board-model.ts 的 `normalizeBoard` 已經擋掉，但這個函式不假設呼叫端
 *     一定正規化過。這些卡片視為各自獨立的頂層，用同一套交錯規則再分一次
 *     `side`，確保沒有任何一張已開工卡片會從結果裡消失。
 *  5. 同一 `side` 內再依 `x` 貪婪分列（見 `packRows`）。
 *
 * 排序鍵全部含 `cardId`（全域唯一），輸出對同一份輸入永遠是同一個結果——
 * Task 5 的 `BoardTimeline` 每次重繪都會呼叫這個函式，配置跳動會讓畫面
 * 閃動。
 */
export function layoutTimeline(
  cards: Card[],
  bounds: { from: string; to: string },
  pxPerDay: number,
): TimelineNode[] {
  const started = cards.filter(isStartedCard);
  const xOf = new Map<string, number>(
    started.map((card) => [
      card.id,
      dayOffset(bounds.from, startedDay(card.startedAt)) * pxPerDay,
    ]),
  );

  const { roots, childrenOf } = buildForest(started);
  const sideOf = new Map<string, Side>();
  interleaveSides(roots, xOf, sideOf);

  const visited = new Set<string>(roots);
  const queue = [...roots];
  for (let parentId = queue.shift(); parentId !== undefined; parentId = queue.shift()) {
    const children = childrenOf.get(parentId);
    if (!children) continue;
    // 走到這裡時 parentId 保證已經在 sideOf 裡：它要麼是剛被 interleaveSides
    // 指派過的頂層卡，要麼是稍早在這個迴圈裡從父卡繼承過 side 才被 push
    // 進 queue 的子卡。?? "top" 只是讓型別成立，不是真的會走到的分支。
    const parentSide = sideOf.get(parentId) ?? "top";
    for (const childId of children) {
      if (visited.has(childId)) continue; // 防禦性：見上方函式註解第 3 點。
      visited.add(childId);
      sideOf.set(childId, parentSide);
      queue.push(childId);
    }
  }

  // 殘餘（見上方函式註解第 4 點）：只有已開工卡片間自己成環才會有東西。
  const leftover = started.map((card) => card.id).filter((id) => !sideOf.has(id));
  if (leftover.length > 0) interleaveSides(leftover, xOf, sideOf);

  const topIds: string[] = [];
  const bottomIds: string[] = [];
  for (const card of started) {
    (sideOf.get(card.id) === "bottom" ? bottomIds : topIds).push(card.id);
  }
  const rowOf = new Map<string, number>([
    ...packRows(topIds, xOf),
    ...packRows(bottomIds, xOf),
  ]);

  return started.map((card) => ({
    cardId: card.id,
    x: xOf.get(card.id) ?? 0,
    side: sideOf.get(card.id) ?? "top",
    row: rowOf.get(card.id) ?? 0,
  }));
}
