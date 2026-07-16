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
