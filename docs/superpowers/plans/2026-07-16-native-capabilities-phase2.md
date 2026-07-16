# Mobile App 階段 2：原生能力（附件 + 語音建卡）— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卡片可附加照片與錄音（本地儲存），並在原生 app 上以裝置內建語音辨識（繁中）快速建卡。

**Architecture:** 新增 `app/platform/` 平台能力抽象層（介面 + Web 實作 + Capacitor 實作），由兩個入口以 React Context 注入；資料模型升級 schema v2（`Card.attachments: AttachmentRef[]` + v1→v2 遷移）；附件二進位檔由平台層儲存（Web 用 IndexedDB、原生用 Capacitor Filesystem），看板 JSON 只存 ref。UI 元件不直接 import Capacitor 插件。

**Tech Stack:** 既有棧 + `@capacitor/camera@8.2.1`、`@capacitor/filesystem@8.1.2`、`@capacitor-community/speech-recognition@7.0.1`、`capacitor-voice-recorder@7.0.6`（皆已驗證相容 core 8.4.1）。

**對應 spec:** `docs/superpowers/specs/2026-07-14-mobile-app-design.md` 第 4、5 節與第 9 節階段 2。spec 第 4 節的 `PlatformCapabilities` 是介面草圖，本計畫將 `recordAudio()` 細化為 `startRecording()/stopRecording()`（錄音需要明確的開始/停止 UI），並補上 spec 隱含需要的 `attachments` 檔案儲存操作 — 語意不變，屬設計深化。

## Global Constraints

- 套件管理 `pnpm`；Node `>=22.13.0`。
- 每個 task 結尾必須通過：`pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`（`typecheck` script 在 Task 2 加入，之前的 task 用 `npx tsc --noEmit` 代替，已驗證現有程式碼通過）。
- 本計畫唯一允許新增的依賴為上列四個 Capacitor 插件（Task 3 安裝）。
- 所有使用者可見文案一律繁體中文。錯誤（權限拒絕、儲存失敗）必須可見、不得靜默，並提供指引；功能降級不崩潰。
- 觸控目標至少 44×44 CSS px；新增動畫須尊重 `prefers-reduced-motion`。
- Web 端（vinext 建置）不得 import 任何 Capacitor 插件模組（只有 `mobile/main.tsx` → `app/platform/capacitor.ts` 這條路徑可以）。
- `STORAGE_KEY`（`"kanban-pwa-board-v1"`）不變 — schema 版本記錄在資料內的 `version` 欄位。
- TypeScript strict；不新增 `any`。
- Commit 訊息：祈使句、無 conventional-commit 前綴。

---

### Task 1: 資料模型 v2 — AttachmentRef 與 v1→v2 遷移

**Files:**
- Modify: `app/board-model.ts`
- Test: `tests/board-attachments.test.ts`（新建）

**Interfaces:**
- Produces（後續 task 依賴）:
  - `type AttachmentType = "photo" | "audio"`
  - `type AttachmentRef = { id: string; type: AttachmentType; fileName: string; mimeType: string; size: number; createdAt: string }`
  - `Card` 增加 `attachments: AttachmentRef[]`
  - `BOARD_SCHEMA_VERSION = 2`
  - `function diffAttachmentRefs(before: AttachmentRef[], after: AttachmentRef[]): { added: AttachmentRef[]; removed: AttachmentRef[] }`
  - `parsePersistedBoard` 接受 version 1（遷移）與 2；其他版本才載入示範資料

- [ ] **Step 1: 寫失敗測試**

建立 `tests/board-attachments.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SCHEMA_VERSION,
  type AttachmentRef,
  assertBoardInvariants,
  createDemoBoard,
  diffAttachmentRefs,
  parsePersistedBoard,
  serializeBoard,
  updateCard,
} from "../app/board-model";

function makeRef(id: string, overrides: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    id,
    type: "photo",
    fileName: `${id}.jpeg`,
    mimeType: "image/jpeg",
    size: 1024,
    createdAt: "2026-07-16T09:00:00.000Z",
    ...overrides,
  };
}

test("schema 版本為 2 且示範卡片帶空附件陣列", () => {
  assert.equal(BOARD_SCHEMA_VERSION, 2);
  const board = createDemoBoard(new Date(2026, 6, 16));
  for (const card of Object.values(board.cards)) {
    assert.deepEqual(card.attachments, []);
  }
});

test("v1 資料無錯遷移為 v2，每張卡片補上 attachments: []", () => {
  const v1 = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 16))));
  v1.version = 1;
  for (const card of Object.values(v1.cards) as Array<Record<string, unknown>>) {
    delete card.attachments;
  }

  const parsed = parsePersistedBoard(JSON.stringify(v1));
  assert.equal(parsed.error, null);
  assert.equal(parsed.board.version, 2);
  assertBoardInvariants(parsed.board);
  for (const card of Object.values(parsed.board.cards)) {
    assert.deepEqual(card.attachments, []);
  }
});

test("非 1 或 2 的版本仍載入示範資料並回報錯誤", () => {
  const bogus = JSON.parse(serializeBoard(createDemoBoard(new Date(2026, 6, 16))));
  bogus.version = 99;
  const parsed = parsePersistedBoard(JSON.stringify(bogus));
  assert.equal(parsed.recovered, true);
  assert.ok(parsed.error);
});

test("updateCard 寫入附件並在序列化往返後保留", () => {
  const board = createDemoBoard(new Date(2026, 6, 16));
  const withRef = updateCard(board, "card-roadmap", {
    attachments: [makeRef("att-1"), makeRef("att-2", { type: "audio", fileName: "att-2.m4a", mimeType: "audio/mp4" })],
  });
  const reloaded = parsePersistedBoard(serializeBoard(withRef));
  assert.equal(reloaded.error, null);
  assert.equal(reloaded.board.cards["card-roadmap"].attachments.length, 2);
  assert.equal(reloaded.board.cards["card-roadmap"].attachments[1].type, "audio");
});

test("附件正規化剔除格式錯誤與重複 id", () => {
  const board = createDemoBoard(new Date(2026, 6, 16));
  const dirty = updateCard(board, "card-roadmap", {
    attachments: [
      makeRef("att-1"),
      makeRef("att-1"),
      { id: "", type: "photo", fileName: "x.png", mimeType: "image/png", size: 1, createdAt: "" } as AttachmentRef,
      { id: "att-3", type: "video", fileName: "x.mp4", mimeType: "video/mp4", size: 1, createdAt: "" } as unknown as AttachmentRef,
      { id: "att-4", type: "photo", fileName: "", mimeType: "image/png", size: 1, createdAt: "" } as AttachmentRef,
    ],
  });
  assert.deepEqual(
    dirty.cards["card-roadmap"].attachments.map((ref) => ref.id),
    ["att-1"],
  );
});

test("diffAttachmentRefs 找出新增與移除", () => {
  const before = [makeRef("a"), makeRef("b")];
  const after = [makeRef("b"), makeRef("c")];
  const diff = diffAttachmentRefs(before, after);
  assert.deepEqual(diff.added.map((ref) => ref.id), ["c"]);
  assert.deepEqual(diff.removed.map((ref) => ref.id), ["a"]);
  const same = diffAttachmentRefs(before, [...before]);
  assert.deepEqual(same.added, []);
  assert.deepEqual(same.removed, []);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test`
Expected: FAIL — `AttachmentRef`/`diffAttachmentRefs` 不存在、`BOARD_SCHEMA_VERSION` 為 1

- [ ] **Step 3: 修改 `app/board-model.ts`**

逐點修改（其餘程式碼不動）：

1. 版本（第 1 行）：

```ts
export const BOARD_SCHEMA_VERSION = 2;
```

2. 在 `ChecklistItem` 型別後新增：

```ts
export type AttachmentType = "photo" | "audio";

export type AttachmentRef = {
  id: string;
  type: AttachmentType;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};
```

3. `Card` 型別在 `members: string[];` 後加一行：

```ts
  attachments: AttachmentRef[];
```

4. `createSeedCard` 的回傳物件在 `members: input.members,` 後加：

```ts
    attachments: [],
```

5. `addCard` 建卡物件在 `members:` 行後加：

```ts
    attachments: normalizeAttachments(input.attachments ?? []),
```

6. `updateCard` 的合併物件在 `members:` 行後加：

```ts
    attachments: normalizeAttachments(patch.attachments ?? existing.attachments),
```

7. `parsePersistedBoard` 的版本檢查改為接受 1 或 2（原 `parsed.version !== BOARD_SCHEMA_VERSION`）：

```ts
    const version = (parsed as { version?: unknown }).version;
    if (!isBoardLike(parsed) || (version !== 1 && version !== BOARD_SCHEMA_VERSION)) {
```

（`normalizeBoard` 會輸出 `version: BOARD_SCHEMA_VERSION` 並經 `normalizeCards` 補上 `attachments`，即完成 v1→v2 遷移。）

8. `normalizeCards` 的物件在 `members:` 行後加：

```ts
      attachments: normalizeAttachments((raw as { attachments?: unknown }).attachments),
```

9. `cloneBoard` 的卡片展開在 `checklist:` 行後加：

```ts
          attachments: card.attachments.map((ref) => ({ ...ref })),
```

10. 新增匯出函式（放在 `assertBoardInvariants` 後）：

```ts
export function diffAttachmentRefs(
  before: AttachmentRef[],
  after: AttachmentRef[],
): { added: AttachmentRef[]; removed: AttachmentRef[] } {
  const beforeIds = new Set(before.map((ref) => ref.id));
  const afterIds = new Set(after.map((ref) => ref.id));
  return {
    added: after.filter((ref) => !beforeIds.has(ref.id)),
    removed: before.filter((ref) => !afterIds.has(ref.id)),
  };
}
```

11. 新增私有正規化函式（放在 `normalizeChecklist` 後）：

```ts
function normalizeAttachments(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: AttachmentRef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const item = raw as Partial<AttachmentRef>;
    if (
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id) ||
      (item.type !== "photo" && item.type !== "audio") ||
      typeof item.fileName !== "string" ||
      !item.fileName
    ) {
      continue;
    }
    seen.add(item.id);
    result.push({
      id: item.id,
      type: item.type,
      fileName: item.fileName,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
      size: Number.isFinite(Number(item.size)) ? Math.max(0, Math.round(Number(item.size))) : 0,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    });
  }
  return result;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS（原 13 + 新 6 = 19 個測試全綠）

- [ ] **Step 5: 全面驗證**

Run: `pnpm test && pnpm lint && npx tsc --noEmit && pnpm build && pnpm mobile:build`
Expected: 全部通過

- [ ] **Step 6: Commit**

```bash
git add app/board-model.ts tests/board-attachments.test.ts
git commit -m "Add attachment refs to board schema with v1 migration"
```

---

### Task 2: 平台能力層 — 介面、Web 實作、Provider 接線

**Files:**
- Create: `app/platform/types.ts`
- Create: `app/platform/web.ts`
- Create: `app/platform/context.tsx`
- Modify: `app/page.tsx`、`mobile/main.tsx`（包 Provider；mobile 暫用 web 實作，Task 3 換）
- Modify: `package.json`（scripts 加 `"typecheck": "tsc --noEmit"`）
- Test: `tests/platform-types.test.ts`（新建）

**Interfaces:**
- Consumes: 無（獨立層）。
- Produces:
  - `type CaptureResult = { base64Data: string; mimeType: string }`
  - `type SavedFile = { fileName: string; size: number }`
  - `interface PlatformCapabilities { isNative: boolean; takePhoto(): Promise<CaptureResult | null>; audio: { startRecording(): Promise<void>; stopRecording(): Promise<CaptureResult | null> }; speech: { available(): Promise<boolean>; start(onPartial: (text: string) => void): Promise<string>; stop(): Promise<void> }; attachments: { save(id: string, capture: CaptureResult): Promise<SavedFile>; loadAsUrl(fileName: string, mimeType: string): Promise<string>; remove(fileName: string): Promise<void> } }`
  - `class CapabilityError extends Error { reason: "permission-denied" | "unavailable" | "failed" }`
  - `function extFromMime(mimeType: string): string`、`function base64ByteSize(base64Data: string): number`
  - `const webCapabilities: PlatformCapabilities`（`app/platform/web.ts`）
  - `PlatformProvider({ capabilities, children })` 與 `usePlatform(): PlatformCapabilities`（`app/platform/context.tsx`）

行為約定（所有實作遵守）：`takePhoto`/`stopRecording` 回傳 `null` 表使用者取消；權限拒絕丟 `CapabilityError("permission-denied", <繁中指引文案>)`；`speech.start(onPartial)` 開始聆聽並持續回呼中間結果，promise 在 `speech.stop()` 之後以最終文字 resolve。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/platform-types.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityError, base64ByteSize, extFromMime } from "../app/platform/types";

test("extFromMime 對常見型別給出副檔名，未知型別給 bin", () => {
  assert.equal(extFromMime("image/jpeg"), "jpeg");
  assert.equal(extFromMime("image/png"), "png");
  assert.equal(extFromMime("audio/mp4"), "m4a");
  assert.equal(extFromMime("audio/webm;codecs=opus"), "webm");
  assert.equal(extFromMime("audio/AAC"), "aac");
  assert.equal(extFromMime("application/x-unknown"), "bin");
});

test("base64ByteSize 以 base64 長度換算位元組數", () => {
  assert.equal(base64ByteSize(Buffer.from("hello").toString("base64")), 5);
  assert.equal(base64ByteSize(Buffer.from([1, 2, 3, 4]).toString("base64")), 4);
  assert.equal(base64ByteSize(""), 0);
});

test("CapabilityError 保留 reason 與訊息", () => {
  const error = new CapabilityError("permission-denied", "請開啟權限");
  assert.equal(error.reason, "permission-denied");
  assert.equal(error.message, "請開啟權限");
  assert.ok(error instanceof Error);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '.../app/platform/types'`

- [ ] **Step 3: 建立 `app/platform/types.ts`**

```ts
export type CaptureResult = {
  base64Data: string;
  mimeType: string;
};

export type SavedFile = {
  fileName: string;
  size: number;
};

export interface PlatformCapabilities {
  isNative: boolean;
  takePhoto(): Promise<CaptureResult | null>;
  audio: {
    startRecording(): Promise<void>;
    stopRecording(): Promise<CaptureResult | null>;
  };
  speech: {
    available(): Promise<boolean>;
    start(onPartial: (text: string) => void): Promise<string>;
    stop(): Promise<void>;
  };
  attachments: {
    save(id: string, capture: CaptureResult): Promise<SavedFile>;
    loadAsUrl(fileName: string, mimeType: string): Promise<string>;
    remove(fileName: string): Promise<void>;
  };
}

export type CapabilityFailureReason = "permission-denied" | "unavailable" | "failed";

export class CapabilityError extends Error {
  reason: CapabilityFailureReason;

  constructor(reason: CapabilityFailureReason, message: string) {
    super(message);
    this.name = "CapabilityError";
    this.reason = reason;
  }
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

export function extFromMime(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return MIME_EXTENSIONS[base] ?? "bin";
}

export function base64ByteSize(base64Data: string): number {
  const clean = base64Data.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS（19 + 3 = 22 綠）

- [ ] **Step 5: 建立 `app/platform/web.ts`**

```ts
import {
  CapabilityError,
  type CaptureResult,
  type PlatformCapabilities,
  type SavedFile,
  extFromMime,
} from "./types";

const DB_NAME = "kanban-attachments";
const STORE_NAME = "files";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new CapabilityError("failed", "附件儲存空間開啟失敗，附件將無法保存。"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(new CapabilityError("failed", "附件寫入失敗，請再試一次。"));
    };
  });
}

function base64ToBlob(base64Data: string, mimeType: string): Blob {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function blobToCapture(blob: Blob, fallbackMime: string): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64Data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      resolve({ base64Data, mimeType: blob.type || fallbackMime });
    };
    reader.onerror = () =>
      reject(new CapabilityError("failed", "檔案讀取失敗，請再試一次。"));
    reader.readAsDataURL(blob);
  });
}

function pickPhotoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

let activeRecorder: MediaRecorder | null = null;
let activeChunks: Blob[] = [];

export const webCapabilities: PlatformCapabilities = {
  isNative: false,

  async takePhoto() {
    const file = await pickPhotoFile();
    if (!file) {
      return null;
    }
    return blobToCapture(file, "image/jpeg");
  },

  audio: {
    async startRecording() {
      if (activeRecorder) {
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new CapabilityError("unavailable", "此瀏覽器不支援錄音。");
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new CapabilityError(
          "permission-denied",
          "無法使用麥克風，請在瀏覽器網站設定允許麥克風。",
        );
      }
      activeChunks = [];
      activeRecorder = new MediaRecorder(stream);
      activeRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          activeChunks.push(event.data);
        }
      });
      activeRecorder.start();
    },

    async stopRecording() {
      const recorder = activeRecorder;
      if (!recorder) {
        return null;
      }
      activeRecorder = null;
      return new Promise<CaptureResult | null>((resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => {
            recorder.stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(activeChunks, { type: recorder.mimeType || "audio/webm" });
            activeChunks = [];
            if (blob.size === 0) {
              resolve(null);
              return;
            }
            blobToCapture(blob, "audio/webm").then(resolve, reject);
          },
          { once: true },
        );
        recorder.stop();
      });
    },
  },

  speech: {
    async available() {
      return false;
    },
    async start() {
      throw new CapabilityError("unavailable", "此瀏覽器不支援語音辨識，請改用原生 app。");
    },
    async stop() {},
  },

  attachments: {
    async save(id, capture): Promise<SavedFile> {
      const fileName = `${id}.${extFromMime(capture.mimeType)}`;
      const blob = base64ToBlob(capture.base64Data, capture.mimeType);
      await withStore("readwrite", (store) => store.put(blob, fileName));
      return { fileName, size: blob.size };
    },

    async loadAsUrl(fileName): Promise<string> {
      const blob = await withStore<Blob | undefined>("readonly", (store) => store.get(fileName));
      if (!blob) {
        throw new CapabilityError("failed", "找不到附件檔案。");
      }
      return URL.createObjectURL(blob);
    },

    async remove(fileName): Promise<void> {
      await withStore("readwrite", (store) => store.delete(fileName));
    },
  },
};
```

- [ ] **Step 6: 建立 `app/platform/context.tsx`**

```tsx
"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { PlatformCapabilities } from "./types";

const PlatformContext = createContext<PlatformCapabilities | null>(null);

export function PlatformProvider({
  capabilities,
  children,
}: {
  capabilities: PlatformCapabilities;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={capabilities}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformCapabilities {
  const capabilities = useContext(PlatformContext);
  if (!capabilities) {
    throw new Error("usePlatform 必須在 PlatformProvider 內使用。");
  }
  return capabilities;
}
```

- [ ] **Step 7: 兩個入口包上 Provider**

`app/page.tsx` 整檔改為：

```tsx
"use client";

import { BoardApp } from "./components/board/BoardApp";
import { PlatformProvider } from "./platform/context";
import { webCapabilities } from "./platform/web";

export default function Home() {
  return (
    <PlatformProvider capabilities={webCapabilities}>
      <BoardApp enableServiceWorker />
    </PlatformProvider>
  );
}
```

`mobile/main.tsx` 整檔改為（暫用 web 實作，Task 3 換成 capacitor 實作）：

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BoardApp } from "../app/components/board/BoardApp";
import { PlatformProvider } from "../app/platform/context";
import { webCapabilities } from "../app/platform/web";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider capabilities={webCapabilities}>
      <BoardApp />
    </PlatformProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: `package.json` scripts 加 typecheck**

在 `"lint"` 行後加入：

```json
"typecheck": "tsc --noEmit",
```

- [ ] **Step 9: 全面驗證**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過（`usePlatform` 尚無人呼叫，行為不變）

- [ ] **Step 10: Commit**

```bash
git add app/platform/ app/page.tsx mobile/main.tsx package.json tests/platform-types.test.ts
git commit -m "Add platform capabilities layer with web implementation"
```

---

### Task 3: Capacitor 平台實作與原生權限設定

**Files:**
- Create: `app/platform/capacitor.ts`
- Modify: `mobile/main.tsx`（換用 capacitor 實作）
- Modify: `package.json`、`pnpm-lock.yaml`（安裝四個插件）
- Modify: `ios/App/App/Info.plist`（權限文案）
- Modify: `android/app/src/main/AndroidManifest.xml`（RECORD_AUDIO + RecognitionService queries）

**Interfaces:**
- Consumes: Task 2 的 `PlatformCapabilities`、`CaptureResult`、`SavedFile`、`CapabilityError`、`extFromMime`、`base64ByteSize`。
- Produces: `const capacitorCapabilities: PlatformCapabilities`（`app/platform/capacitor.ts`），行為約定同 Task 2。

- [ ] **Step 1: 安裝插件**

Run: `pnpm add @capacitor/camera@8.2.1 @capacitor/filesystem@8.1.2 @capacitor-community/speech-recognition@7.0.1 capacitor-voice-recorder@7.0.6`
Expected: 安裝成功、無 peer dependency 錯誤（皆相容 core 8.4.1）

- [ ] **Step 2: 建立 `app/platform/capacitor.ts`**

```ts
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { VoiceRecorder } from "capacitor-voice-recorder";
import {
  CapabilityError,
  type CaptureResult,
  type PlatformCapabilities,
  type SavedFile,
  base64ByteSize,
  extFromMime,
} from "./types";

const ATTACHMENT_DIR = "attachments";

function isUserCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

export const capacitorCapabilities: PlatformCapabilities = {
  isNative: true,

  async takePhoto() {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        quality: 80,
        promptLabelHeader: "新增照片",
        promptLabelPhoto: "從相簿選擇",
        promptLabelPicture: "拍照",
        promptLabelCancel: "取消",
      });
      if (!photo.base64String) {
        return null;
      }
      const format = (photo.format || "jpeg").toLowerCase();
      return { base64Data: photo.base64String, mimeType: `image/${format}` };
    } catch (error) {
      if (isUserCancelled(error)) {
        return null;
      }
      throw new CapabilityError(
        "permission-denied",
        "無法使用相機或相簿，請到「設定」開啟本 app 的相機與照片權限。",
      );
    }
  },

  audio: {
    async startRecording() {
      const can = await VoiceRecorder.canDeviceVoiceRecord();
      if (!can.value) {
        throw new CapabilityError("unavailable", "此裝置不支援錄音。");
      }
      const permission = await VoiceRecorder.requestAudioRecordingPermission();
      if (!permission.value) {
        throw new CapabilityError(
          "permission-denied",
          "無法使用麥克風，請到「設定」開啟本 app 的麥克風權限。",
        );
      }
      await VoiceRecorder.startRecording();
    },

    async stopRecording() {
      try {
        const result = await VoiceRecorder.stopRecording();
        const data = result.value;
        if (!data?.recordDataBase64) {
          return null;
        }
        return {
          base64Data: data.recordDataBase64,
          mimeType: data.mimeType || "audio/aac",
        };
      } catch {
        return null;
      }
    },
  },

  speech: {
    async available() {
      try {
        const result = await SpeechRecognition.available();
        return result.available;
      } catch {
        return false;
      }
    },

    async start(onPartial) {
      const permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted") {
        throw new CapabilityError(
          "permission-denied",
          "無法使用語音辨識，請到「設定」開啟本 app 的語音辨識與麥克風權限。",
        );
      }
      const listener = await SpeechRecognition.addListener("partialResults", (event) => {
        const text = event.matches?.[0];
        if (text) {
          onPartial(text);
        }
      });
      try {
        const result = await SpeechRecognition.start({
          language: "zh-TW",
          partialResults: true,
          popup: false,
        });
        return result?.matches?.[0] ?? "";
      } finally {
        await listener.remove();
      }
    },

    async stop() {
      try {
        await SpeechRecognition.stop();
      } catch {
        // 未在聆聽時呼叫 stop 可安全忽略
      }
    },
  },

  attachments: {
    async save(id, capture): Promise<SavedFile> {
      const fileName = `${id}.${extFromMime(capture.mimeType)}`;
      await Filesystem.writeFile({
        path: `${ATTACHMENT_DIR}/${fileName}`,
        data: capture.base64Data,
        directory: Directory.Data,
        recursive: true,
      });
      return { fileName, size: base64ByteSize(capture.base64Data) };
    },

    async loadAsUrl(fileName, mimeType): Promise<string> {
      const file = await Filesystem.readFile({
        path: `${ATTACHMENT_DIR}/${fileName}`,
        directory: Directory.Data,
      });
      return `data:${mimeType};base64,${file.data as string}`;
    },

    async remove(fileName): Promise<void> {
      try {
        await Filesystem.deleteFile({
          path: `${ATTACHMENT_DIR}/${fileName}`,
          directory: Directory.Data,
        });
      } catch {
        // 檔案已不存在時忽略
      }
    },
  },
};
```

（若插件實際 API 簽名與上述有出入 — 例如事件名稱或權限回傳欄位 — 以 `node_modules` 內該插件的 `.d.ts` 為準修正，並在報告記錄差異。）

- [ ] **Step 3: `mobile/main.tsx` 換用 capacitor 實作**

把 `import { webCapabilities } from "../app/platform/web";` 改為 `import { capacitorCapabilities } from "../app/platform/capacitor";`，並把 `capabilities={webCapabilities}` 改為 `capabilities={capacitorCapabilities}`。

- [ ] **Step 4: iOS 權限文案**

`ios/App/App/Info.plist` 在最外層 `<dict>` 內（`CFBundleVersion` 之後）加入：

```xml
	<key>NSCameraUsageDescription</key>
	<string>拍照後附加到看板卡片。</string>
	<key>NSPhotoLibraryUsageDescription</key>
	<string>從相簿選擇照片附加到卡片。</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>錄音附加到卡片，以及語音輸入建立卡片。</string>
	<key>NSSpeechRecognitionUsageDescription</key>
	<string>將語音轉為文字以快速建立卡片。</string>
```

- [ ] **Step 5: Android 權限**

`android/app/src/main/AndroidManifest.xml`：

1. 在既有 `<uses-permission android:name="android.permission.INTERNET" />` 旁加入：

```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
```

2. 在 `<application>` 區塊外（`</application>` 之後、`</manifest>` 之前）加入：

```xml
    <queries>
        <intent>
            <action android:name="android.speech.RecognitionService" />
        </intent>
    </queries>
```

（若檔內已有 `<queries>` 區塊則把 `<intent>` 併入既有區塊。）

- [ ] **Step 6: 同步原生專案並驗證**

Run: `pnpm mobile:sync`
Expected: 成功；輸出列出 4 個插件（camera、filesystem、speech-recognition、voice-recorder）同步進 ios 與 android

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過。特別驗證 `pnpm build`（vinext web）成功 — 證明 Capacitor 插件沒有洩入 web 建置路徑

Run: `cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug && cd ..`
Expected: BUILD SUCCESSFUL（插件的原生程式碼可編譯）

- [ ] **Step 7: Commit**

```bash
git add app/platform/capacitor.ts mobile/main.tsx package.json pnpm-lock.yaml ios/ android/
git commit -m "Add Capacitor platform implementation with native permissions"
```

---

### Task 4: 附件 UI 與檔案生命週期

**Files:**
- Modify: `app/components/board/shared.ts`（CardDraft 加 attachments）
- Create: `app/components/board/AttachmentSection.tsx`
- Modify: `app/components/board/DetailModal.tsx`（掛入 AttachmentSection）
- Modify: `app/components/board/CardItem.tsx`（cardMeta 顯示附件數）
- Modify: `app/components/board/BoardApp.tsx`（生命週期清理 + capabilityMessage）
- Modify: `app/globals.css`（附件樣式）
- Test: `tests/board-draft.test.ts`（更新 draft 測試）

**Interfaces:**
- Consumes: Task 1 的 `AttachmentRef`、`diffAttachmentRefs`；Task 2 的 `usePlatform`、`CapabilityError`。
- Produces:
  - `CardDraft` 增加 `attachments: AttachmentRef[]`；`createDraft()` 回傳含 `attachments: []`；`draftFromCard` 深拷貝 `card.attachments`；`draftToCardInput` 帶出 `attachments`。
  - `AttachmentSection({ attachments, onChange, onError }: { attachments: AttachmentRef[]; onChange: (next: AttachmentRef[]) => void; onError: (error: unknown) => void })`（named export）。
  - `DetailModal` props 增加 `onCapabilityError: (error: unknown) => void`。
  - `BoardApp` 內新增 `capabilityMessage` 狀態與 `reportCapabilityError(error: unknown)`（Task 5 重用）。

檔案生命週期規則（實作於 BoardApp）：
- 附件擷取當下即存檔（`platform.attachments.save`），ref 進 draft。
- **儲存**：`diffAttachmentRefs(original, draft.attachments).removed` 的檔案刪除（original：edit 模式 = `board.cards[cardId].attachments`，add 模式 = `[]`）。
- **取消/關閉未儲存**：`diffAttachmentRefs(original, draft.attachments).added` 的檔案刪除（清孤兒）。
- **刪卡**：刪除該卡全部附件檔案。**重設示範資料**：刪除所有卡片的全部附件檔案。
- 檔案刪除一律 fire-and-forget 並 `catch`（刪除失敗不阻斷看板操作，殘檔可容忍 — 與 spec 第 6 節孤兒物件原則一致）。

- [ ] **Step 1: 更新 draft 測試（先失敗）**

`tests/board-draft.test.ts` 修改既有測試並新增：

1. `createDraft` 測試加一行斷言：

```ts
  assert.deepEqual(draft.attachments, []);
```

2. `draftFromCard` 測試改用帶附件的卡片並加斷言（在既有斷言後）：

```ts
  const boardWithRef = updateCard(board, card.id, {
    attachments: [{
      id: "att-1", type: "photo", fileName: "att-1.jpeg",
      mimeType: "image/jpeg", size: 10, createdAt: "2026-07-16T09:00:00.000Z",
    }],
  });
  const draftWithRef = draftFromCard(boardWithRef.cards[card.id]);
  assert.equal(draftWithRef.attachments.length, 1);
  assert.notEqual(draftWithRef.attachments, boardWithRef.cards[card.id].attachments);
```

（檔頭 import 需加 `updateCard`。）

3. 新增測試：

```ts
test("draftToCardInput 帶出附件參照", () => {
  const draft = {
    ...createDraft(),
    title: "帶附件",
    attachments: [{
      id: "att-9", type: "audio" as const, fileName: "att-9.m4a",
      mimeType: "audio/mp4", size: 99, createdAt: "2026-07-16T09:00:00.000Z",
    }],
  };
  assert.deepEqual(draftToCardInput(draft).attachments.map((ref) => ref.id), ["att-9"]);
});
```

Run: `pnpm test` → Expected: FAIL（`CardDraft` 尚無 `attachments`）

- [ ] **Step 2: 更新 `app/components/board/shared.ts`**

1. import 加 `AttachmentRef`：`import type { ..., AttachmentRef } from "../../board-model";`（併入既有 type import）。
2. `CardDraft` 加欄位 `attachments: AttachmentRef[];`。
3. `createDraft()` 回傳物件加 `attachments: [],`。
4. `draftFromCard` 回傳物件加 `attachments: card.attachments.map((ref) => ({ ...ref })),`。
5. `draftToCardInput` 回傳物件加 `attachments: draft.attachments,`。

Run: `pnpm test` → Expected: PASS

- [ ] **Step 3: 建立 `app/components/board/AttachmentSection.tsx`**

```tsx
"use client";

import type { AttachmentRef } from "../../board-model";
import { usePlatform } from "../../platform/context";
import { makeId } from "../../board-model";
import { useEffect, useState } from "react";

export function AttachmentSection({
  attachments,
  onChange,
  onError,
}: {
  attachments: AttachmentRef[];
  onChange: (next: AttachmentRef[]) => void;
  onError: (error: unknown) => void;
}) {
  const platform = usePlatform();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  async function addPhoto() {
    setBusy(true);
    try {
      const capture = await platform.takePhoto();
      if (!capture) {
        return;
      }
      const id = makeId("att");
      const saved = await platform.attachments.save(id, capture);
      onChange([
        ...attachments,
        {
          id,
          type: "photo",
          fileName: saved.fileName,
          mimeType: capture.mimeType,
          size: saved.size,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (!recording) {
      try {
        await platform.audio.startRecording();
        setRecording(true);
      } catch (error) {
        onError(error);
      }
      return;
    }

    setRecording(false);
    setBusy(true);
    try {
      const capture = await platform.audio.stopRecording();
      if (!capture) {
        return;
      }
      const id = makeId("att");
      const saved = await platform.attachments.save(id, capture);
      onChange([
        ...attachments,
        {
          id,
          type: "audio",
          fileName: saved.fileName,
          mimeType: capture.mimeType,
          size: saved.size,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="fieldGroup">
      <legend>附件</legend>
      <div className="attachmentActions">
        <button type="button" className="secondaryButton" disabled={busy || recording} onClick={addPhoto}>
          ＋ 照片
        </button>
        <button
          type="button"
          className={`secondaryButton ${recording ? "recordingActive" : ""}`}
          aria-pressed={recording}
          disabled={busy}
          onClick={toggleRecording}
        >
          {recording ? "■ 停止錄音" : "● 錄音"}
        </button>
        {recording && (
          <span className="recordingHint" aria-live="polite">
            錄音中…再按一次完成
          </span>
        )}
      </div>
      {attachments.length === 0 ? (
        <p className="attachmentEmpty">尚無附件</p>
      ) : (
        <ul className="attachmentList">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              onRemove={() => onChange(attachments.filter((ref) => ref.id !== attachment.id))}
            />
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function AttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: AttachmentRef;
  onRemove: () => void;
}) {
  const platform = usePlatform();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    platform.attachments
      .loadAsUrl(attachment.fileName, attachment.mimeType)
      .then((value) => {
        if (cancelled) {
          if (value.startsWith("blob:")) {
            URL.revokeObjectURL(value);
          }
          return;
        }
        objectUrl = value;
        setUrl(value);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [platform, attachment.fileName, attachment.mimeType]);

  return (
    <li className="attachmentItem">
      {attachment.type === "photo" ? (
        url ? (
          <img className="attachmentThumb" src={url} alt={`照片附件 ${attachment.fileName}`} />
        ) : (
          <span className="attachmentThumb attachmentPending" aria-hidden="true" />
        )
      ) : url ? (
        <audio className="attachmentAudio" controls src={url} aria-label={`錄音附件 ${attachment.fileName}`} />
      ) : (
        <span className="attachmentPending">載入中…</span>
      )}
      {failed && <span className="attachmentError">附件載入失敗</span>}
      <button
        type="button"
        className="iconOnly"
        aria-label={`移除附件 ${attachment.fileName}`}
        onClick={onRemove}
      >
        −
      </button>
    </li>
  );
}
```

- [ ] **Step 4: `DetailModal.tsx` 掛入附件區**

1. props 型別加 `onCapabilityError: (error: unknown) => void;`，解構加 `onCapabilityError`。
2. 檔頭加 `import { AttachmentSection } from "./AttachmentSection";`。
3. 在「清單」fieldset（`<fieldset className="fieldGroup"><legend>清單</legend>`）**之前**插入：

```tsx
          <AttachmentSection
            attachments={draft.attachments}
            onChange={(attachments) => setDraft({ attachments })}
            onError={onCapabilityError}
          />
```

- [ ] **Step 5: `CardItem.tsx` 顯示附件數**

在 `cardMeta` 區塊內、`{card.members.length > 0 && ...}` 之後加入：

```tsx
        {card.attachments.length > 0 && <span>附件：{card.attachments.length}</span>}
```

- [ ] **Step 6: `BoardApp.tsx` 生命週期與訊息**

1. 檔頭 import 加：

```ts
import { diffAttachmentRefs, type AttachmentRef } from "../../board-model";
import { usePlatform } from "../../platform/context";
import { CapabilityError } from "../../platform/types";
```

（`diffAttachmentRefs`、`AttachmentRef` 併入既有 board-model import。）

2. 元件內加狀態與工具（放在既有 state 宣告後）：

```tsx
  const platform = usePlatform();
  const [capabilityMessage, setCapabilityMessage] = useState("");

  function reportCapabilityError(error: unknown) {
    setCapabilityMessage(
      error instanceof CapabilityError ? error.message : "操作失敗，請再試一次。",
    );
  }

  function removeAttachmentFiles(refs: AttachmentRef[]) {
    for (const ref of refs) {
      void platform.attachments.remove(ref.fileName).catch(() => {});
    }
  }

  function detailOriginalAttachments(current: DetailState): AttachmentRef[] {
    return current.mode === "edit" ? (board.cards[current.cardId]?.attachments ?? []) : [];
  }
```

3. `closeOverlays()` 改為（取消時清孤兒檔案）：

```tsx
  function closeOverlays() {
    if (detail) {
      const { added } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
      removeAttachmentFiles(added);
    }
    setDetail(null);
    setConfirmAction(null);
  }
```

4. `saveDetail` 在 `setDetail(null);` 之前加（儲存時刪被移除的檔案）：

```tsx
    const { removed } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
    removeAttachmentFiles(removed);
```

5. `confirmDelete` 在 `setBoard(...)` 之前加：

```tsx
    removeAttachmentFiles(board.cards[cardId]?.attachments ?? []);
```

6. `confirmReset` 開頭加：

```tsx
    removeAttachmentFiles(Object.values(board.cards).flatMap((card) => card.attachments));
```

7. noticeStack 條件與內容加入 capabilityMessage：條件改為 `{(filtersActive || storageMessage || capabilityMessage) && (`，並在 `storageMessage` 那行後加：

```tsx
          {capabilityMessage && (
            <p className="notice warning">
              {capabilityMessage}
              <button
                type="button"
                className="iconOnly"
                aria-label="關閉訊息"
                onClick={() => setCapabilityMessage("")}
              >
                ×
              </button>
            </p>
          )}
```

8. `DetailModal` 呼叫處加 prop：`onCapabilityError={reportCapabilityError}`。

注意：`ConfirmModal` 的取消（`onCancel`）只關確認框，不動 detail draft；只有 `closeOverlays`（Escape/×/取消按鈕）與 `saveDetail` 處理附件檔案。請檢查現有呼叫點：detail 的關閉一律走 `closeOverlays` 或 `saveDetail`，`requestDelete` 內的 `setDetail(null)` 是「編輯 → 要求刪卡」的轉場 — 此處 draft 中新增的附件屬於即將被刪的卡，交由 `confirmDelete` 刪原卡附件即可，但 draft 新增而尚未儲存的檔案會殘留：在 `requestDelete` 的 `setDetail(null)` 前加同 `closeOverlays` 的孤兒清理：

```tsx
    if (detail) {
      const { added } = diffAttachmentRefs(detailOriginalAttachments(detail), detail.draft.attachments);
      removeAttachmentFiles(added);
    }
```

- [ ] **Step 7: `app/globals.css` 附件樣式**

在檔尾加入：

```css
.attachmentActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.recordingActive {
  border-color: var(--rose);
  color: var(--rose);
}

.recordingHint {
  color: var(--rose);
  font-size: 0.85rem;
}

.attachmentEmpty {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 8px 0 0;
}

.attachmentList {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
}

.attachmentItem {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 8px;
  background: var(--paper);
}

.attachmentThumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--line);
}

.attachmentPending {
  color: var(--muted);
  font-size: 0.85rem;
}

.attachmentAudio {
  flex: 1;
  min-width: 0;
  height: 40px;
}

.attachmentError {
  color: var(--rose);
  font-size: 0.85rem;
}
```

- [ ] **Step 8: 全面驗證 + Web 煙霧測試**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過

Web 煙霧（`pnpm dev` + chrome-devtools MCP）：
1. 開卡片詳情 → 附件區顯示「＋ 照片」「● 錄音」與「尚無附件」。
2. 按「＋ 照片」→ 以 `upload_file` 提供一張測試圖（可先以 script 產生 PNG）→ 縮圖出現 → 儲存 → 卡片 meta 顯示「附件：1」。
3. 重新整理 → 開同卡 → 縮圖仍載入（IndexedDB 持久化）。
4. 移除附件 → 儲存 → 附件消失。
5. 新增卡片時加照片後按「取消」→ 不留下卡片（孤兒檔案已在背景清除，UI 無異狀、Console 無錯誤）。

- [ ] **Step 9: Commit**

```bash
git add app/components/board/ app/globals.css tests/board-draft.test.ts
git commit -m "Add card attachments UI with file lifecycle cleanup"
```

---

### Task 5: 語音快速建卡

**Files:**
- Create: `app/components/board/VoiceCaptureButton.tsx`
- Modify: `app/components/board/BoardApp.tsx`（欄尾掛按鈕 + speechAvailable）
- Modify: `app/globals.css`（麥克風按鈕樣式）

**Interfaces:**
- Consumes: Task 2 的 `usePlatform`；Task 4 的 `reportCapabilityError`、`createDraft`。
- Produces: `VoiceCaptureButton({ columnTitle, onResult, onError }: { columnTitle: string; onResult: (text: string) => void; onError: (error: unknown) => void })`（named export）。

互動規格（spec 第 5 節）：**按住說話** — pointerdown 開始聆聽並即時顯示辨識中間結果，pointerup/pointercancel/pointerleave 結束；鍵盤等效：Space/Enter keydown 開始（防 repeat）、keyup 結束。放開後最終文字（空白則取最後 partial）非空 → `onResult(text)` → BoardApp 開啟新增卡片視窗、標題預填、可修改後儲存。

- [ ] **Step 1: 建立 `app/components/board/VoiceCaptureButton.tsx`**

```tsx
"use client";

import { usePlatform } from "../../platform/context";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export function VoiceCaptureButton({
  columnTitle,
  onResult,
  onError,
}: {
  columnTitle: string;
  onResult: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const platform = usePlatform();
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const partialRef = useRef("");
  const listeningRef = useRef(false);

  async function begin() {
    if (listeningRef.current) {
      return;
    }
    listeningRef.current = true;
    partialRef.current = "";
    setPartial("");
    setListening(true);
    try {
      const finalText = await platform.speech.start((text) => {
        partialRef.current = text;
        setPartial(text);
      });
      const chosen = (finalText || partialRef.current).trim();
      if (chosen) {
        onResult(chosen);
      }
    } catch (error) {
      onError(error);
    } finally {
      listeningRef.current = false;
      setListening(false);
      setPartial("");
    }
  }

  function end() {
    if (listeningRef.current) {
      void platform.speech.stop().catch(() => {});
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      void begin();
    }
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      end();
    }
  }

  return (
    <span className="voiceCapture">
      <button
        type="button"
        className={`voiceButton ${listening ? "listening" : ""}`}
        aria-pressed={listening}
        aria-label={`按住以語音新增卡片到${columnTitle}`}
        title="按住說話，放開完成"
        onPointerDown={() => void begin()}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        {listening ? "聆聽中…" : "🎤"}
      </button>
      <span className="voicePartial" aria-live="polite">
        {partial}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: `BoardApp.tsx` 掛入按鈕**

1. 檔頭加 `import { VoiceCaptureButton } from "./VoiceCaptureButton";`。
2. 狀態區加（`capabilityMessage` 之後）：

```tsx
  const [speechAvailable, setSpeechAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    platform.speech
      .available()
      .then((available) => {
        if (!cancelled) {
          setSpeechAvailable(available);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [platform]);
```

3. 新增 handler（`openAdd` 之後）：

```tsx
  function openAddWithTitle(columnId: string, title: string) {
    setRestoreFocusId(null);
    setDetail({ mode: "add", columnId, draft: { ...createDraft(), title } });
    setLiveMessage(`已辨識語音，請確認卡片內容後儲存。`);
  }
```

4. 欄尾的 `<button type="button" className="addCardButton" ...>＋ 新增卡片</button>` 包成一列並附麥克風（speech 可用時才顯示）：

```tsx
              <div className="addCardRow">
                <button type="button" className="addCardButton" onClick={() => openAdd(column.id)}>
                  ＋ 新增卡片
                </button>
                {speechAvailable && (
                  <VoiceCaptureButton
                    columnTitle={column.title}
                    onResult={(text) => openAddWithTitle(column.id, text)}
                    onError={reportCapabilityError}
                  />
                )}
              </div>
```

- [ ] **Step 3: `app/globals.css` 樣式**

檔尾加入：

```css
.addCardRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.addCardRow .addCardButton {
  flex: 1;
}

.voiceCapture {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.voiceButton {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper);
  font-size: 1rem;
  touch-action: none;
}

.voiceButton.listening {
  border-color: var(--teal-strong);
  color: var(--teal-strong);
  animation: voicePulse 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .voiceButton.listening {
    animation: none;
  }
}

@keyframes voicePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.35); }
  50% { box-shadow: 0 0 0 8px rgba(15, 118, 110, 0); }
}

.voicePartial {
  color: var(--muted);
  font-size: 0.85rem;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: 全面驗證 + Web 降級煙霧測試**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build`
Expected: 全部通過

Web 煙霧（chrome-devtools）：看板欄尾**不**顯示 🎤（web `speech.available()` = false），「＋ 新增卡片」照常運作，Console 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add app/components/board/VoiceCaptureButton.tsx app/components/board/BoardApp.tsx app/globals.css
git commit -m "Add hold-to-talk voice card creation on native"
```

---

### Task 6: 收尾驗證、模擬器驗收與文件

**Files:**
- Modify: `README.md`（Mobile 段落補階段 2 說明）

- [ ] **Step 1: 全量驗證**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm mobile:build && pnpm mobile:sync`
Expected: 全部通過

- [ ] **Step 2: iOS 模擬器驗收（自動化可行部分）**

Run: `npx cap run ios --target <可用 iPhone 模擬器 UDID>`（`xcrun simctl list devices available` 取得）

以 `xcrun simctl io booted screenshot` + 讀圖驗證：
1. 冷啟動看板正常、欄尾出現 🎤 按鈕（iOS 模擬器 `SpeechRecognition.available()` 通常回 true；若回 false 則截圖記錄按鈕隱藏 — 兩者皆為正確降級行為，如實記錄何者發生）。
2. `xcrun simctl addmedia booted <測試圖>` 後無法自動點按 UI — 相機/相簿/錄音/語音的互動驗收列入人工清單。
3. terminate → relaunch → 看板仍正常（無白屏、無錯誤警示）。

- [ ] **Step 3: README 補充**

`README.md` Mobile 段落（階段 1 所加）的 bullet 清單後追加：

```markdown

原生能力（階段 2）：卡片附件（拍照/相簿、錄音）與按住說話的語音建卡（繁中，裝置內建辨識）。附件檔案存於裝置本地（原生 Filesystem / 瀏覽器 IndexedDB），看板資料只存參照；行動 app 與瀏覽器的資料各自獨立，雲端同步屬後續階段。
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document native attachment and voice capture features"
```

- [ ] **Step 5: 彙整剩餘人工驗收清單（寫入報告，不入 repo）**

實機必測：拍照/相簿附件、錄音附件與播放、按住說話繁中辨識與建卡、權限拒絕後的指引文案與降級、附件在 app 重啟後仍可載入、刪卡/重設後檔案清理（可用 Xcode → Devices 檢視 app container 的 `Documents/attachments/`）。

---

## Self-Review 紀錄

- **Spec 覆蓋**：spec 第 4 節能力表 → Task 2（web fallback：照片 input、錄音 MediaRecorder、語音隱藏）+ Task 3（Capacitor 三插件）；第 5 節卡片附件（附件區、AttachmentRef、schema v2 遷移）→ Task 1 + 4；語音建卡（按住說話、partial 顯示、放開帶入標題）→ Task 5；權限處理（首次使用才請求、拒絕給指引、降級不崩潰）→ Task 2/3 的 CapabilityError 文案 + Task 4 的 capabilityMessage；spec 第 7 節「語音辨識中斷保留已辨識文字」→ VoiceCaptureButton 以 partialRef 保留最後中間結果。
- **介面細化聲明**：`recordAudio()` → `startRecording()/stopRecording()`、新增 `attachments` 儲存操作與 `isNative`，於計畫開頭聲明為設計深化。
- **型別一致性**：`AttachmentRef` 欄位（id/type/fileName/mimeType/size/createdAt）在 Task 1/2/4 一致；`PlatformCapabilities` 簽名在 Task 2 定義、Task 3 實作、Task 4/5 消費，逐一核對相符；`onCapabilityError` prop 與 `reportCapabilityError` 名稱在 Task 4/5 一致。
- **無占位符**：Task 3 Step 2 附註「以插件 .d.ts 為準修正」是明確的驗證指令而非 TBD；模擬器無法自動點按的部分明列為人工清單。
