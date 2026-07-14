# Mobile App 階段 1：Capacitor 殼與元件重構 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把看板 UI 從 `app/page.tsx` 抽成共用元件，新增純 Vite 的 mobile 入口與 Capacitor iOS/Android 專案，讓現有 PWA 功能原封不動地跑在側載的原生 app 裡。

**Architecture:** 看板 UI 拆為 `app/components/board/` 下的聚焦元件，Web（vinext `page.tsx`）與 Mobile（`mobile/main.tsx` + 獨立 Vite config）兩個入口掛載同一套元件；Capacitor `webDir` 指向 `dist/mobile` 靜態 bundle。Service worker 註冊只在 Web 入口啟用（Capacitor 的 `capacitor://` scheme 不支援 SW）。

**Tech Stack:** React 19、TypeScript（strict）、Tailwind 4（root `postcss.config.mjs`）、Vite（已在 devDependencies）、Capacitor（core/cli/ios/android，本計畫新增）、`node:test` + `tsx` 跑測試。

**對應 spec:** `docs/superpowers/specs/2026-07-14-mobile-app-design.md` 第 3 節（整體架構）與第 9 節階段 1。平台能力抽象層（spec 第 4 節）依 YAGNI 留給階段 2，於首個消費者（相機）落地時建立。

## Global Constraints

- 套件管理用 `pnpm`（`pnpm@11.11.0`），Node `>=22.13.0`。
- 測試：`pnpm test`（`tsx --test tests/*.test.ts`）；Lint：`pnpm lint`；Web 建置：`pnpm build`。三者在每個 task 結尾都必須通過。
- 本計畫是行為保持的重構 + 新增建置目標：**不得更改任何使用者可見文案與行為**（全部繁體中文文案原樣搬移）。
- TypeScript strict；不新增 `any`。
- 除 Task 6/7 的 Capacitor 套件（`@capacitor/core`、`@capacitor/cli`、`@capacitor/ios`、`@capacitor/android`）外不新增依賴。
- `dist/` 已在 `.gitignore`，`dist/mobile` 建置產物不入版控；Capacitor 產生的 `ios/`、`android/` 原生專案要入版控（Capacitor 官方建議）。
- Commit 訊息風格比照現有 repo：繁中或英文祈使句、無 conventional-commit 前綴（例：`Implement Kanban PWA MVP`）。

---

### Task 1: 抽出共用型別與純函式 → `app/components/board/shared.ts`

**Files:**
- Create: `app/components/board/shared.ts`
- Test: `tests/board-draft.test.ts`
- Modify: `app/page.tsx`（刪除被搬走的宣告，改為 import）

**Interfaces:**
- Consumes: `app/board-model.ts` 的 `BoardState`、`Card`、`ChecklistItem`、`Column`、`Filters`、`Priority` 型別。
- Produces（後續 task 依賴的精確簽名）:
  - `type StyleWithVars = CSSProperties & Partial<Record<"--label" | "--progress", string>>`
  - `type CardDraft = { title: string; description: string; priority: Priority; labelIds: string[]; dueDate: string; members: string; checklist: ChecklistItem[] }`
  - `type DetailState = { mode: "add"; columnId: string; draft: CardDraft } | { mode: "edit"; cardId: string; draft: CardDraft }`
  - `type ConfirmState = { type: "delete"; cardId: string; title: string } | { type: "reset" } | null`
  - `const emptyFilters: Filters`
  - `const priorityText: Record<Priority, string>`
  - `function createDraft(): CardDraft`
  - `function draftFromCard(card: Card): CardDraft`
  - `function draftToCardInput(draft: CardDraft): { title: string; description: string; priority: Priority; labelIds: string[]; dueDate: string; members: string[]; checklist: ChecklistItem[] }`
  - `function locateCard(board: BoardState, cardId: string): { columnIndex: number; cardIndex: number } | null`
  - `function findNearestFocus(columns: Column[], cardId: string): string | null`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/board-draft.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDraft,
  draftFromCard,
  draftToCardInput,
  findNearestFocus,
  locateCard,
} from "../app/components/board/shared";
import { createDemoBoard } from "../app/board-model";

test("createDraft 以空白欄位與中優先級起始", () => {
  const draft = createDraft();
  assert.equal(draft.title, "");
  assert.equal(draft.priority, "medium");
  assert.deepEqual(draft.labelIds, []);
  assert.deepEqual(draft.checklist, []);
});

test("draftFromCard 複製欄位並以逗號串接成員、深拷貝清單", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const card = board.cards["card-roadmap"];
  const draft = draftFromCard(card);
  assert.equal(draft.title, card.title);
  assert.equal(draft.members, card.members.join(", "));
  assert.notEqual(draft.checklist, card.checklist);
  assert.notEqual(draft.checklist[0], card.checklist[0]);
});

test("draftToCardInput 修剪成員字串並剔除空項", () => {
  const draft = { ...createDraft(), members: " 雅婷 , , Kai " };
  const input = draftToCardInput(draft);
  assert.deepEqual(input.members, ["雅婷", "Kai"]);
});

test("locateCard 回傳欄與卡索引，找不到回傳 null", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const position = locateCard(board, "card-roadmap");
  assert.ok(position);
  assert.equal(typeof position.columnIndex, "number");
  assert.equal(board.columns[position.columnIndex].cardIds[position.cardIndex], "card-roadmap");
  assert.equal(locateCard(board, "card-不存在"), null);
});

test("findNearestFocus 優先取同欄下一張，否則上一張，否則 null", () => {
  const board = createDemoBoard(new Date(2026, 6, 10));
  const column = board.columns.find((entry) => entry.cardIds.length >= 2);
  assert.ok(column);
  const [first, second] = column.cardIds;
  assert.equal(findNearestFocus(board.columns, first), second);
  assert.equal(findNearestFocus(board.columns, "card-不存在"), null);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '.../app/components/board/shared'`

- [ ] **Step 3: 建立 `app/components/board/shared.ts`**

內容為自 `app/page.tsx` 原樣搬移的宣告（`page.tsx:29-61`、`page.tsx:858-915`），加上型別化簽名：

```ts
import type {
  BoardState,
  Card,
  ChecklistItem,
  Column,
  Filters,
  Priority,
} from "../../board-model";
import type { CSSProperties } from "react";

export type StyleWithVars = CSSProperties &
  Partial<Record<"--label" | "--progress", string>>;

export type CardDraft = {
  title: string;
  description: string;
  priority: Priority;
  labelIds: string[];
  dueDate: string;
  members: string;
  checklist: ChecklistItem[];
};

export type DetailState =
  | { mode: "add"; columnId: string; draft: CardDraft }
  | { mode: "edit"; cardId: string; draft: CardDraft };

export type ConfirmState =
  | { type: "delete"; cardId: string; title: string }
  | { type: "reset" }
  | null;

export const emptyFilters: Filters = {
  query: "",
  labelId: "",
  priority: "all",
  due: "all",
};

export const priorityText: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function createDraft(): CardDraft {
  return {
    title: "",
    description: "",
    priority: "medium",
    labelIds: [],
    dueDate: "",
    members: "",
    checklist: [],
  };
}

export function draftFromCard(card: Card): CardDraft {
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    labelIds: [...card.labelIds],
    dueDate: card.dueDate,
    members: card.members.join(", "),
    checklist: card.checklist.map((item) => ({ ...item })),
  };
}

export function draftToCardInput(draft: CardDraft) {
  return {
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    labelIds: draft.labelIds,
    dueDate: draft.dueDate,
    members: draft.members
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean),
    checklist: draft.checklist,
  };
}

export function locateCard(board: BoardState, cardId: string) {
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const cardIndex = board.columns[columnIndex].cardIds.indexOf(cardId);
    if (cardIndex >= 0) {
      return { columnIndex, cardIndex };
    }
  }
  return null;
}

export function findNearestFocus(columns: Column[], cardId: string) {
  for (const column of columns) {
    const index = column.cardIds.indexOf(cardId);
    if (index >= 0) {
      return column.cardIds[index + 1] ?? column.cardIds[index - 1] ?? null;
    }
  }
  return null;
}
```

（原 `locateCard`/`findNearestFocus` 用 `ReturnType<typeof createDemoBoard>` 表達型別，等價改為 `BoardState`/`Column[]`，語意不變。）

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS（新增 5 個測試 + 原有測試全綠）

- [ ] **Step 5: 讓 `app/page.tsx` 改用 shared**

在 `app/page.tsx`：
1. 刪除本地宣告：`StyleWithVars`（29 行）、`CardDraft`（31-39 行）、`DetailState`（41-43 行）、`ConfirmState`（45-48 行）、`emptyFilters`（50-55 行）、`priorityText`（57-61 行）、檔尾的 `createDraft`、`draftFromCard`、`draftToCardInput`、`locateCard`、`findNearestFocus`（858-915 行）。
2. 在 import 區塊加入：

```ts
import {
  type CardDraft,
  type ConfirmState,
  type DetailState,
  type StyleWithVars,
  createDraft,
  draftFromCard,
  draftToCardInput,
  emptyFilters,
  findNearestFocus,
  locateCard,
  priorityText,
} from "./components/board/shared";
```

3. `findNearestFocus(board.columns, cardId)` 呼叫處（原 191 行）簽名不變，無需改動。

- [ ] **Step 6: 全面驗證**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 全部通過，無型別錯誤

- [ ] **Step 7: Commit**

```bash
git add app/components/board/shared.ts tests/board-draft.test.ts app/page.tsx
git commit -m "Extract shared board UI types and draft helpers"
```

---

### Task 2: 抽出卡片元件 → `app/components/board/CardItem.tsx`

**Files:**
- Create: `app/components/board/CardItem.tsx`
- Modify: `app/page.tsx`（刪除 `CardItem`、`IconButton`，改為 import）

**Interfaces:**
- Consumes: Task 1 的 `StyleWithVars`、`priorityText`；`board-model` 的 `Card`、`Label` 型別。
- Produces: `export function CardItem(props: CardItemProps)`，props 形狀與原 `page.tsx:462-474` 完全相同（`card: Card; labels: Label[]; today: string; movementDisabled: boolean; onOpen: () => void; onMove: (direction: "up" | "down" | "left" | "right") => void; onChecklistToggle: (itemId: string) => void; setRef: (node: HTMLButtonElement | null) => void; onDragStart: () => void; onDragEnd: () => void; onDropBefore: () => void`）。`IconButton` 為此檔私有。

- [ ] **Step 1: 建立 `app/components/board/CardItem.tsx`**

自 `app/page.tsx:450-583`（`CardItem`）與 `page.tsx:840-856`（`IconButton`）原樣搬移，僅補 import 與 `labels` 型別改用 `Label[]`（與原內聯型別等價）：

```tsx
"use client";

import type { Card, Label } from "../../board-model";
import { type StyleWithVars, priorityText } from "./shared";
import type { KeyboardEvent } from "react";

export function CardItem({
  card,
  labels,
  today,
  movementDisabled,
  onOpen,
  onMove,
  onChecklistToggle,
  setRef,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  card: Card;
  labels: Label[];
  today: string;
  movementDisabled: boolean;
  onOpen: () => void;
  onMove: (direction: "up" | "down" | "left" | "right") => void;
  onChecklistToggle: (itemId: string) => void;
  setRef: (node: HTMLButtonElement | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  // …函式本體自 page.tsx:475-582 一字不改搬入（doneCount/isOverdue/cardLabels、
  // handleKeyDown、整段 JSX）…
}

function IconButton({
  label,
  text,
  disabled,
  onClick,
}: {
  label: string;
  text: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="iconMove" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}
```

搬移規則（此檔與後續元件 task 一體適用）：**函式本體與 JSX 一字不改**，只允許改 import 與上述 props 型別標註；執行者不得「順手優化」。

- [ ] **Step 2: 更新 `app/page.tsx`**

1. 刪除 `CardItem`（450-583 行）與 `IconButton`（840-856 行）。
2. import 區塊加入 `import { CardItem } from "./components/board/CardItem";`。
3. 移除 page.tsx 內因搬移而不再使用的 import（`KeyboardEvent`；若 `priorityText`、`StyleWithVars` 已無其他使用處也一併移除 — `StyleWithVars` 仍被 `DetailModal` 使用，保留至 Task 3）。

- [ ] **Step 3: 驗證**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 全部通過

- [ ] **Step 4: Commit**

```bash
git add app/components/board/CardItem.tsx app/page.tsx
git commit -m "Extract CardItem component"
```

---

### Task 3: 抽出兩個對話框 → `DetailModal.tsx`、`ConfirmModal.tsx`

**Files:**
- Create: `app/components/board/DetailModal.tsx`
- Create: `app/components/board/ConfirmModal.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: Task 1 的 `CardDraft`、`DetailState`、`ConfirmState`、`StyleWithVars`；`board-model` 的 `Label`、`Priority`、`makeId`。
- Produces:
  - `export function DetailModal(props: { detail: DetailState; labels: Label[]; modalRef: RefObject<HTMLDivElement | null>; onClose: () => void; onDelete?: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDraftChange: (draft: CardDraft) => void })`
  - `export function ConfirmModal(props: { confirmAction: Exclude<ConfirmState, null>; modalRef: RefObject<HTMLDivElement | null>; onCancel: () => void; onConfirm: () => void })`

- [ ] **Step 1: 建立 `app/components/board/DetailModal.tsx`**

自 `page.tsx:585-782` 原樣搬移，檔頭：

```tsx
"use client";

import { type Label, type Priority, makeId } from "../../board-model";
import { type CardDraft, type DetailState, type StyleWithVars } from "./shared";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
```

props 中 `labels` 型別改為 `Label[]`（等價），其餘一字不改。

- [ ] **Step 2: 建立 `app/components/board/ConfirmModal.tsx`**

自 `page.tsx:784-829` 原樣搬移，檔頭：

```tsx
"use client";

import type { ConfirmState } from "./shared";
import type { RefObject } from "react";
```

- [ ] **Step 3: 更新 `app/page.tsx`**

1. 刪除 `DetailModal`、`ConfirmModal` 函式。
2. 加入 `import { DetailModal } from "./components/board/DetailModal";` 與 `import { ConfirmModal } from "./components/board/ConfirmModal";`。
3. 清掉不再使用的 import（`makeId` 仍被 `saveDetail` 的 `makeId("card")` 使用，保留；`StyleWithVars` 此時已無使用處，移除）。

- [ ] **Step 4: 驗證**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add app/components/board/DetailModal.tsx app/components/board/ConfirmModal.tsx app/page.tsx
git commit -m "Extract DetailModal and ConfirmModal components"
```

---

### Task 4: 抽出容器元件 `BoardApp`，`page.tsx` 縮為薄入口

**Files:**
- Create: `app/components/board/BoardApp.tsx`
- Modify: `app/page.tsx`（縮為 6 行入口）

**Interfaces:**
- Consumes: Task 1-3 全部產出；`board-model` 的狀態操作函式。
- Produces: `export function BoardApp({ enableServiceWorker = false }: { enableServiceWorker?: boolean })` — **Task 5 的 mobile 入口與 page.tsx 都掛載這個元件**。`enableServiceWorker` 為 true 時才註冊 `/sw.js`（Capacitor `capacitor://` scheme 不支援 SW，且註冊失敗會誤觸「離線快取啟用失敗」警示文案）。

- [ ] **Step 1: 建立 `app/components/board/BoardApp.tsx`**

搬移 `page.tsx` 剩餘全部內容（`Home` 本體 63-448 行與 `Stat` 831-838 行）。改動僅限：

1. 函式更名 `Home` → `BoardApp`（named export），加入 prop：

```tsx
export function BoardApp({
  enableServiceWorker = false,
}: {
  enableServiceWorker?: boolean;
}) {
```

2. SW 註冊 effect（原 110-116 行）加上開關，依賴陣列補上 prop：

```tsx
useEffect(() => {
  if (!enableServiceWorker) {
    return;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      setStorageMessage("離線快取啟用失敗；本機資料仍會保存在此瀏覽器。");
    });
  }
}, [enableServiceWorker]);
```

3. 檔頭 import（`board-model` 相對路徑改為 `../../board-model`，shared/元件改為 `./`）：

```tsx
"use client";

import {
  STORAGE_KEY,
  addCard,
  createDemoBoard,
  deleteCard,
  filterCards,
  getBoardStats,
  getColumnWip,
  getLocalDateString,
  isFilterActive,
  makeId,
  moveCard,
  moveCardRelative,
  parsePersistedBoard,
  serializeBoard,
  toggleChecklistItem,
  updateCard,
  updateWipLimit,
} from "../../board-model";
import {
  type DetailState,
  createDraft,
  draftFromCard,
  draftToCardInput,
  emptyFilters,
  findNearestFocus,
  locateCard,
} from "./shared";
import type { ConfirmState } from "./shared";
import { CardItem } from "./CardItem";
import { ConfirmModal } from "./ConfirmModal";
import { DetailModal } from "./DetailModal";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
```

其餘（狀態、effects、事件處理、JSX、`Stat`）一字不改。

- [ ] **Step 2: 改寫 `app/page.tsx` 為薄入口**

整檔替換為：

```tsx
"use client";

import { BoardApp } from "./components/board/BoardApp";

export default function Home() {
  return <BoardApp enableServiceWorker />;
}
```

- [ ] **Step 3: 驗證建置與測試**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 全部通過

- [ ] **Step 4: Web 手動煙霧測試**

Run: `pnpm dev`，瀏覽器開啟輸出的本機網址，逐項確認：

1. 看板載入且四欄與示範卡片顯示。
2. 新增一張卡片 → 重新整理 → 卡片仍在（localStorage 持久化）。
3. 用卡片的 ↑↓←→ 按鈕移動卡片，WIP 計數更新。
4. 開啟卡片詳情、Escape 關閉。
5. DevTools Console 無錯誤，Application → Service Workers 顯示 sw.js 已註冊。

Expected: 全部行為與重構前一致

- [ ] **Step 5: Commit**

```bash
git add app/components/board/BoardApp.tsx app/page.tsx
git commit -m "Extract BoardApp container; slim page.tsx to web entry"
```

---

### Task 5: Mobile Vite 入口與建置目標

**Files:**
- Create: `mobile/index.html`
- Create: `mobile/main.tsx`
- Create: `vite.mobile.config.ts`
- Modify: `package.json`（scripts 加 `mobile:build`）

**Interfaces:**
- Consumes: Task 4 的 `BoardApp`（不帶 `enableServiceWorker`，即 mobile 不註冊 SW）。
- Produces: `pnpm mobile:build` → `dist/mobile/`（`index.html` + assets），為 Task 6 Capacitor 的 `webDir`。

- [ ] **Step 1: 建立 `mobile/index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <meta name="theme-color" content="#f7f5ef" />
    <title>本機 Kanban 看板</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

（`viewport-fit=cover` 必要：`globals.css` 以 `env(safe-area-inset-*)` 處理瀏海安全區。）

- [ ] **Step 2: 建立 `mobile/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BoardApp } from "../app/components/board/BoardApp";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BoardApp />
  </StrictMode>,
);
```

- [ ] **Step 3: 建立 `vite.mobile.config.ts`**

```ts
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Mobile 入口是純靜態 client bundle（Capacitor webDir 用），
// 與 vite.config.ts 的 vinext/Cloudflare web 建置完全分離。
export default defineConfig({
  root: "mobile",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/mobile", import.meta.url)),
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: `package.json` 加 script**

在 `scripts` 中加入：

```json
"mobile:build": "vite build --config vite.mobile.config.ts"
```

- [ ] **Step 5: 驗證兩條建置路徑互不干擾**

Run: `pnpm mobile:build`
Expected: 成功，`dist/mobile/index.html` 與 `dist/mobile/assets/*.js`、`*.css` 存在。CSS 檔內含 `.appShell`（Tailwind 4 由根目錄 `postcss.config.mjs` 處理；`"use client"` 指令在 Vite bundle 會有無害的 rollup 警告，可忽略）。

Run: `ls dist/mobile && grep -l "appShell" dist/mobile/assets/*.css`
Expected: 檔案齊全、grep 有命中

Run: `pnpm build && pnpm test && pnpm lint`
Expected: Web 建置與測試不受影響，全部通過

- [ ] **Step 6: 本機預覽煙霧測試**

Run: `npx vite preview --config vite.mobile.config.ts`，瀏覽器開啟輸出網址：

1. 看板正常渲染、可新增卡片、重新整理後保留。
2. Console 無 SW 註冊、無「離線快取啟用失敗」警示。

- [ ] **Step 7: Commit**

```bash
git add mobile/ vite.mobile.config.ts package.json
git commit -m "Add mobile Vite entry building static bundle to dist/mobile"
```

---

### Task 6: Capacitor 專案與 iOS 側載

**Files:**
- Create: `capacitor.config.ts`
- Create: `ios/`（由 `cap add ios` 產生，入版控）
- Modify: `package.json`（依賴 + scripts）

**Interfaces:**
- Consumes: Task 5 的 `dist/mobile`。
- Produces: 可在 iOS 模擬器/實機執行的 app；scripts `mobile:sync`（建置+同步）、`mobile:ios`（開 Xcode）。

- [ ] **Step 1: 確認 iOS 工具鏈**

Run: `xcodebuild -version && pod --version`
Expected: Xcode 版本與 CocoaPods 版本各一行。若缺 CocoaPods：`brew install cocoapods` 後重試。若缺 Xcode，停止並回報使用者（需先從 App Store 安裝）。

- [ ] **Step 2: 安裝 Capacitor**

Run: `pnpm add @capacitor/core @capacitor/ios && pnpm add -D @capacitor/cli`
Expected: 安裝成功（core 與 ios 版本一致）

- [ ] **Step 3: 建立 `capacitor.config.ts`**

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.wongchambers.kanban",
  appName: "本機 Kanban",
  webDir: "dist/mobile",
};

export default config;
```

- [ ] **Step 4: 產生 iOS 專案並同步**

Run: `pnpm mobile:build && npx cap add ios && npx cap sync ios`
Expected: `ios/App/App.xcworkspace` 存在；`sync` 把 `dist/mobile` 複製進 `ios/App/App/public` 並安裝 Pods，無錯誤

- [ ] **Step 5: `package.json` 加 scripts**

```json
"mobile:sync": "pnpm mobile:build && cap sync",
"mobile:ios": "cap open ios"
```

- [ ] **Step 6: 模擬器驗收**

Run: `npx cap run ios`（選任一 iPhone 模擬器；或 `pnpm mobile:ios` 從 Xcode 按 Run）

手動確認：
1. App 冷啟動直接顯示看板（無網路請求、無白屏）。
2. 新增/編輯/移動卡片可用；觸控拖曳與 ↑↓←→ 按鈕皆可移動。
3. 完全關閉 app（上滑移除）再開 → 資料仍在（WKWebView localStorage 持久化）。
4. 頂部狀態列未壓到「本機 Kanban 看板」標題（safe-area 生效）。
5. 無「離線快取啟用失敗」警示。
6. 開啟飛航模式 → app 一切照常（本地 bundle，無網路依賴）。

Expected: 全部通過。任何一項失敗即為阻斷問題，修復後重驗。

- [ ] **Step 7: 實機側載（有接 iPhone 時）**

Xcode → Signing & Capabilities → Team 選個人 Apple ID（免費帳號，7 天簽章效期）→ 選實機 Run。重複 Step 6 清單，額外確認鍵盤彈出時對話框輸入框不被遮擋。無實機時跳過並在 commit 訊息註明僅模擬器驗證。

- [ ] **Step 8: Commit**

```bash
git add capacitor.config.ts ios/ package.json pnpm-lock.yaml
git commit -m "Add Capacitor iOS shell loading dist/mobile bundle"
```

---

### Task 7: Android 側載（條件性）

**前置條件：** 本機已安裝 Android Studio 與 SDK（檢查：`ls "$HOME/Library/Android/sdk" 2>/dev/null`）。未安裝則整個 task 跳過，於 plan 勾選處註記「跳過：無 Android SDK」，不視為失敗。

**Files:**
- Create: `android/`（由 `cap add android` 產生，入版控）
- Modify: `package.json`（依賴）

- [ ] **Step 1: 安裝並產生專案**

Run: `pnpm add @capacitor/android && pnpm mobile:build && npx cap add android && npx cap sync android`
Expected: `android/` 專案產生、sync 成功

- [ ] **Step 2: 模擬器/實機驗收**

Run: `npx cap run android`
手動確認項目同 Task 6 Step 6（第 3 點改為系統多工鍵移除後重開）。

- [ ] **Step 3: Commit**

```bash
git add android/ package.json pnpm-lock.yaml
git commit -m "Add Capacitor Android shell"
```

---

### Task 8: 收尾驗證與文件

**Files:**
- Modify: `README.md`（加「Mobile（Capacitor）」段落）

- [ ] **Step 1: 全量驗證**

Run: `pnpm test && pnpm lint && pnpm build && pnpm mobile:build`
Expected: 全部通過

- [ ] **Step 2: README 加 Mobile 段落**

在 `README.md` 的「Useful Commands」段落前插入：

```markdown
## Mobile（Capacitor）

行動版把 `app/components/board/` 的同一套看板元件，經 `mobile/` 入口以純 Vite 打包成靜態 bundle，交給 Capacitor 原生殼載入（不註冊 service worker）。

- `pnpm mobile:build`：打包 `dist/mobile`
- `pnpm mobile:sync`：打包並同步到原生專案
- `pnpm mobile:ios`：開啟 Xcode（實機側載用個人簽章）
- 改了 web 元件後，重跑 `pnpm mobile:sync` 即可更新 app 內容
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document Capacitor mobile workflow"
```

---

## Self-Review 紀錄

- **Spec 覆蓋**：spec 第 3 節架構（共用元件、雙入口、mobile 入口、Capacitor、SW 僅 web）→ Task 1-6；第 9 節階段 1 驗收「裝上手機可跑（功能同 PWA）」→ Task 6 Step 6/7。spec 第 4-8 節屬階段 2/3，本計畫刻意不含（平台能力層依 YAGNI 延至階段 2 首個消費者）。
- **型別一致性**：`BoardApp({ enableServiceWorker })`、`CardItem`/`DetailModal`/`ConfirmModal` props、shared.ts 匯出簽名已在各 task Interfaces 區塊逐一核對相符。
- **無占位符**：Task 2 Step 1 的「函式本體一字不改搬入」附有精確原始行號（page.tsx:475-582），非 placeholder — 執行者以原檔為準原樣搬移，此規則本身就是規格。
