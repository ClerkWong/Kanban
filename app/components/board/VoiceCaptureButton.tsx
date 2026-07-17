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
