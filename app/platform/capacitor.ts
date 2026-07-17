import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { VoiceRecorder } from "capacitor-voice-recorder";
import {
  CapabilityError,
  type PlatformCapabilities,
  type SavedFile,
  base64ByteSize,
  extFromMime,
} from "./types";

const ATTACHMENT_DIR = "attachments";

type SpeechSession = {
  lastText: string;
  settle: ((text: string) => void) | null;
  listener: { remove: () => Promise<void> } | null;
  stopRequested: boolean;
};

let speechSession: SpeechSession | null = null;

async function finishSpeechSession(session: SpeechSession): Promise<void> {
  if (speechSession === session) {
    speechSession = null;
  }
  try {
    await SpeechRecognition.stop();
  } catch {
    // 未在聆聽時可安全忽略
  }
  await session.listener?.remove().catch(() => {});
  session.settle?.(session.lastText);
}

function isUserCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

// capacitor-voice-recorder 在未有作用中的錄音時，iOS/Android/Web 三端
// 皆會以此字串拒絕 stopRecording()（見 predefined-web-responses.ts、
// ios/Plugin/Messages.swift、android Messages.java）。
const RECORDING_HAS_NOT_STARTED = "RECORDING_HAS_NOT_STARTED";

function isNoActiveRecordingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(RECORDING_HAS_NOT_STARTED);
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
      let result;
      try {
        result = await VoiceRecorder.stopRecording();
      } catch (error) {
        if (isNoActiveRecordingError(error)) {
          return null;
        }
        throw new CapabilityError("failed", "錄音失敗，請再試一次。");
      }
      const data = result.value;
      if (!data?.recordDataBase64) {
        return null;
      }
      return {
        base64Data: data.recordDataBase64,
        mimeType: data.mimeType || "audio/aac",
      };
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
      if (speechSession) {
        throw new CapabilityError("failed", "語音辨識已在進行中。");
      }
      const session: SpeechSession = {
        lastText: "",
        settle: null,
        listener: null,
        stopRequested: false,
      };
      speechSession = session;
      try {
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== "granted") {
          throw new CapabilityError(
            "permission-denied",
            "無法使用語音辨識，請到「設定」開啟本 app 的語音辨識與麥克風權限。",
          );
        }
        session.listener = await SpeechRecognition.addListener("partialResults", (event) => {
          const text = event.matches?.[0];
          if (text && speechSession === session) {
            session.lastText = text;
            onPartial(text);
          }
        });
      } catch (error) {
        if (speechSession === session) {
          speechSession = null;
        }
        await session.listener?.remove().catch(() => {});
        throw error instanceof CapabilityError
          ? error
          : new CapabilityError("failed", "語音辨識啟動失敗，請再試一次。");
      }

      return new Promise<string>((resolve, reject) => {
        session.settle = resolve;
        void SpeechRecognition.start({
          language: "zh-TW",
          partialResults: true,
          popup: false,
        })
          .then(() => {
            if (session.stopRequested) {
              void finishSpeechSession(session);
            }
          })
          .catch(async () => {
            if (speechSession === session) {
              speechSession = null;
            }
            await session.listener?.remove().catch(() => {});
            reject(new CapabilityError("failed", "語音辨識啟動失敗，請再試一次。"));
          });
      });
    },

    async stop() {
      const session = speechSession;
      if (!session) {
        return;
      }
      session.stopRequested = true;
      if (session.settle) {
        await finishSpeechSession(session);
      }
      // settle 尚未就緒（佈建中）時，由 start 的 then/catch 依 stopRequested 收尾
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
