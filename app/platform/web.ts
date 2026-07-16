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
