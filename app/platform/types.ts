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
