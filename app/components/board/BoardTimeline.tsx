"use client";

// 看板時間軸魚骨圖（board-timeline-fishbone-v1）。只吃 board 與一個開卡回呼，
// 不碰同步、不碰 store——狀態與資料都由 BoardApp 持有；這裡純粹是把
// timeline-model.ts 算好的 x／side／row 畫成畫面。
//
// 排版計算（開工日換算、天數差、父子分組、交錯、分列）一律呼叫
// timeline-model.ts 的匯出，不在這裡重算——那個模組才是這個功能唯一的自動化
// 行為防線（見它自己的檔頭註解）。這個檔案唯一自己動手的「計算」是把已經算好
// 的整數（x、side、row）換算成像素座標，以及決定日期刻度多密——兩者都是純
// 展示決策，不影響任何排版結果。

import { useEffect, useMemo, useState } from "react";
import type { BoardState, Card } from "../../board-model";
import { todayString } from "../../projects/calendar-model";
import {
  DEFAULT_PX_PER_DAY,
  TIMELINE_CARD_WIDTH,
  ZOOM_LEVELS,
  dayOffset,
  layoutTimeline,
  startedDay,
  timelineBounds,
  unstartedCards,
  type TimelineNode,
} from "../../projects/timeline-model";
import { isImeComposing } from "./shared";

// 卡片節點的像素常數。只決定 layoutTimeline 算出的 x／side／row 要怎麼畫，
// 不影響、也不重算那三個值本身；因此不需要跟 timeline-model.ts 共用或匯出。
const NODE_HEIGHT = 92;
const ROW_GAP = 14;
const ROW_STEP = NODE_HEIGHT + ROW_GAP;
const SPINE_GAP = 22;
const AXIS_HEIGHT = 30;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 軸上刻度的日期文字，純展示用途。「刻度該多密」是展示層決策，
 * timeline-model.ts 的匯出不包含它；換算沿用 dayOffset 的 UTC 慣例，確保刻度
 * 落點與 layoutTimeline 算出的卡片 x 座標同一套座標系——跟
 * ResourceView.tsx 的 weekdayLabel 同理，留在元件內、不下放到共用模組。
 */
function buildTicks(
  bounds: { from: string; to: string },
  pxPerDay: number,
): Array<{ day: string; x: number; label: string }> {
  const span = dayOffset(bounds.from, bounds.to);
  const interval = pxPerDay >= 24 ? 1 : pxPerDay >= 12 ? 3 : 7;
  const fromMs = Date.parse(`${bounds.from}T00:00:00Z`);
  const ticks: Array<{ day: string; x: number; label: string }> = [];
  // 月份沒變時只顯示日：pxPerDay=24／32 每天一格，格寬只有 24～32px，
  // 「月/日」兩位數月加兩位數日（例如「12/31」）量出來比 24px 寬，會跟隔壁
  // 刻度疊字；只在跨月（含第一格）才顯示月份，兩者之間必定隔至少 28 天、
  // 不可能連續出現兩個「月/日」全稱互疊，同時維持看得出月份切換點。
  let lastMonth = -1;
  for (let offset = 0; offset <= span; offset += interval) {
    const date = new Date(fromMs + offset * 86_400_000);
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    const month = date.getUTCMonth();
    const label = month === lastMonth ? `${date.getUTCDate()}` : `${month + 1}/${date.getUTCDate()}`;
    lastMonth = month;
    ticks.push({ day, x: offset * pxPerDay, label });
  }
  return ticks;
}

/** 型別窄化用；layoutTimeline 回傳的節點只含已開工卡片，這裡只是讓
 *  TypeScript 知道，不是重新判斷「開工與否」——那個判斷已經在
 *  timeline-model.ts 內做完了。 */
function hasStarted(card: Card): card is Card & { startedAt: string } {
  return card.startedAt !== null;
}

function nodeTop(node: TimelineNode, centerY: number): number {
  return node.side === "top"
    ? centerY - SPINE_GAP - node.row * ROW_STEP - NODE_HEIGHT
    : centerY + SPINE_GAP + node.row * ROW_STEP;
}

/** 節點卡片上「離主骨最近」那個邊的中點，連接線的端點都取這裡。 */
function anchorPoint(node: TimelineNode, centerY: number): { x: number; y: number } {
  const top = nodeTop(node, centerY);
  return {
    x: node.x + TIMELINE_CARD_WIDTH / 2,
    y: node.side === "top" ? top + NODE_HEIGHT : top,
  };
}

export function BoardTimeline({
  board,
  onOpenCard,
  overlayOpen,
}: {
  board: BoardState;
  onOpenCard: (cardId: string) => void;
  /** BoardApp 目前是否開著 DetailModal／確認刪除／同步設定／月報表／欄位
   *  編輯這類最上層 overlay。全螢幕的 Esc handler 靠這個判斷「這次 Esc
   *  該不該連坐關全螢幕」，而不是自己去嗅探 DOM 或依賴其他元件有沒有呼叫
   *  preventDefault——那兩種做法都會讓這裡偷偷依賴別的元件的實作細節。 */
  overlayOpen: boolean;
}) {
  const [pxPerDay, setPxPerDay] = useState<number>(DEFAULT_PX_PER_DAY);
  const [fullscreen, setFullscreen] = useState(false);

  // 全螢幕是 CSS 覆蓋視窗（見下方 .timelineFullscreen 的取捨），不是瀏覽器
  // Fullscreen API，沒有內建的 Esc 退出，這裡補上；只在全螢幕開著時掛
  // document 層的 keydown，關閉時（不論是按這裡的 Esc 還是點退出鈕）移除。
  //
  // overlayOpen 為真時直接 return，不關全螢幕：DetailModal／ConfirmModal
  // 等 modal 自己的 Esc 關閉走 React onKeyDown（bubble phase、掛在 root
  // container），不會（也不該）呼叫 stopPropagation。這個 listener**必須**
  // 掛在 capture phase：bubble phase 的 document listener 會在 React 的
  // root container 之後才收到同一次原生事件，但 React 對 discrete event
  // （keydown 屬於這一類）會同步 flush——modal 的 onClose 觸發的
  // setState／重渲染／這個 effect 的清理＋重跑，全部在原生事件抵達
  // document 的 bubble 階段之前就完成，屆時 document 上已經換成
  // overlayOpen:false 的新 handler，guard 形同沒設（實測踩過這個坑，
  // 用時間戳證實：closure 置換發生在原生事件到達 document 之前）。
  // capture phase 在事件抵達 root container 之前就執行，讀到的
  // overlayOpen 一定是「這次按鍵發生前」的狀態，不會被同一次事件觸發的
  // 重渲染搶先換班。
  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (isImeComposing(event)) return;
      if (event.key !== "Escape") return;
      if (overlayOpen) return;
      setFullscreen(false);
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [fullscreen, overlayOpen]);

  const cards = useMemo(() => Object.values(board.cards), [board.cards]);
  const today = useMemo(() => todayString(), []);
  const bounds = useMemo(() => timelineBounds(cards, today), [cards, today]);
  // 規格 §4.4：排版一次算完，不在渲染迴圈裡重算——nodes 只在 board.cards／
  // bounds／pxPerDay 真的變動時才重新呼叫 layoutTimeline。
  const nodes = useMemo(
    () => (bounds ? layoutTimeline(cards, bounds, pxPerDay) : []),
    [cards, bounds, pxPerDay],
  );
  const waiting = useMemo(() => unstartedCards(cards), [cards]);
  const ticks = useMemo(() => (bounds ? buildTicks(bounds, pxPerDay) : []), [bounds, pxPerDay]);

  const renderable = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.cardId, node] as const));
    const entries: Array<{
      card: Card & { startedAt: string };
      node: TimelineNode;
      parentNode: TimelineNode | null;
    }> = [];
    for (const node of nodes) {
      const card = board.cards[node.cardId];
      if (!card || !hasStarted(card)) continue;
      const parent = card.parentCardId ? nodeById.get(card.parentCardId) ?? null : null;
      entries.push({
        card,
        node,
        // 只在同側才畫父連線；不同側只會在「已開工卡片之間自己成環」的殘餘
        // 情形出現（見 timeline-model.ts 的 layoutTimeline 註解第 4 點），是
        // 縱深防禦而非正常路徑——這裡退回「直接接主骨」，避免畫出跨越主骨
        // 的連線。父卡未開工（不在 nodeById 內）時 parent 本來就是 null，
        // 走的也是同一個退回分支，剛好對應規格「父卡未開工時子卡直接接
        // 主骨」的規則，不需要另外特判。
        parentNode: parent && parent.side === node.side ? parent : null,
      });
    }
    return entries;
  }, [nodes, board.cards]);

  const { topRows, bottomRows } = useMemo(() => {
    let top = 0;
    let bottom = 0;
    for (const node of nodes) {
      if (node.side === "top") top = Math.max(top, node.row + 1);
      else bottom = Math.max(bottom, node.row + 1);
    }
    return { topRows: top, bottomRows: bottom };
  }, [nodes]);

  const centerY = AXIS_HEIGHT + SPINE_GAP + topRows * ROW_STEP;
  const trackHeight = centerY + SPINE_GAP + bottomRows * ROW_STEP;
  const spineWidth = bounds
    ? dayOffset(bounds.from, bounds.to) * pxPerDay + TIMELINE_CARD_WIDTH
    : 0;

  return (
    <section
      className={`timelineShell${fullscreen ? " timelineFullscreen" : ""}`}
      aria-label="看板時間軸魚骨圖"
    >
      <header className="timelineToolbar">
        <div className="timelineZoom" role="group" aria-label="縮放級距">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={pxPerDay === level ? "filterToggle active" : "filterToggle"}
              aria-pressed={pxPerDay === level}
              onClick={() => setPxPerDay(level)}
            >
              {level}px/日
            </button>
          ))}
        </div>
        <button
          type="button"
          className={fullscreen ? "filterToggle active" : "filterToggle"}
          aria-pressed={fullscreen}
          onClick={() => setFullscreen((value) => !value)}
        >
          {fullscreen ? "退出全螢幕" : "全螢幕"}
        </button>
      </header>

      <p className="timelineNarrowNotice">
        魚骨圖需要較寬的畫面，請在桌面瀏覽器使用。
      </p>

      <div className="timelineScroll">
        <aside className="timelineUnstarted" aria-label="未啟動">
          <h2>未啟動</h2>
          {waiting.length === 0 ? (
            <p className="emptyState">目前沒有未開工的卡片。</p>
          ) : (
            <ul>
              {waiting.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    className={`timelineCard${card.blocked ? " blocked" : ""}${
                      card.serviceClass === "expedite" ? " expedite" : ""
                    }`}
                    title={card.title}
                    onClick={() => onOpenCard(card.id)}
                  >
                    <TimelineCardFace card={card} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {bounds === null ? (
          <p className="emptyState">
            這張看板還沒有任務開工。卡片移出第一欄之後就會出現在時間軸上。
          </p>
        ) : (
          <div className="timelineSpine" style={{ width: spineWidth, height: trackHeight }}>
            {ticks.map((tick) => (
              <div key={tick.day} className="timelineTick" style={{ left: tick.x }}>
                <span>{tick.label}</span>
              </div>
            ))}

            <div className="timelineBar" style={{ top: centerY }} aria-hidden="true" />

            <svg
              className="timelineLinkLayer"
              width={spineWidth}
              height={trackHeight}
              aria-hidden="true"
            >
              {renderable.map(({ card, node, parentNode }) => {
                const from = anchorPoint(node, centerY);
                const to = parentNode ? anchorPoint(parentNode, centerY) : { x: from.x, y: centerY };
                return (
                  <line
                    key={card.id}
                    className={parentNode ? "timelineLink toParent" : "timelineLink toSpine"}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                  />
                );
              })}
            </svg>

            {renderable.map(({ card, node }) => (
              <div
                key={card.id}
                className="timelineNode"
                style={{
                  left: node.x,
                  top: nodeTop(node, centerY),
                  width: TIMELINE_CARD_WIDTH,
                  height: NODE_HEIGHT,
                }}
              >
                <button
                  type="button"
                  className={`timelineCard${card.blocked ? " blocked" : ""}${
                    card.serviceClass === "expedite" ? " expedite" : ""
                  }`}
                  title={card.title}
                  onClick={() => onOpenCard(card.id)}
                >
                  <TimelineCardFace card={card} dateLabel={startedDay(card.startedAt)} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 卡面內容，時間軸節點與未啟動池共用。不做子樹聚合計數——checklist 的
 *  N/M 只反映這張卡自己的清單，這是規格 §2.1 的核心約束。 */
function TimelineCardFace({ card, dateLabel }: { card: Card; dateLabel?: string }) {
  const doneCount = card.checklist.filter((item) => item.done).length;
  return (
    <>
      <span className="timelineCardTitle">{card.title}</span>
      <span className="timelineCardMeta">
        {dateLabel && <span>{dateLabel}</span>}
        {card.checklist.length > 0 && (
          <span>
            清單 {doneCount}/{card.checklist.length}
          </span>
        )}
      </span>
      {(card.blocked || card.serviceClass === "expedite") && (
        <span className="timelineCardFlags">
          {card.blocked && <span>卡住</span>}
          {card.serviceClass === "expedite" && <span>加急</span>}
        </span>
      )}
    </>
  );
}
