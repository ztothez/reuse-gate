import { useEffect, useRef, useState } from "react";
import { MAX_AUDIO_BYTES, transcribeAudio, voiceErrorMessage } from "./api";

type Phase = "idle" | "starting" | "recording" | "transcribing" | "review" | "error";
export function useVoiceInput(disabled: boolean) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(false);
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const request = useRef<AbortController | null>(null);
  const starting = useRef(false);
  const review = useRef<HTMLTextAreaElement>(null);
  function release() {
    if (timeout.current) clearTimeout(timeout.current);
    if (ticker.current) clearInterval(ticker.current);
    timeout.current = null;
    ticker.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  useEffect(() => {
    alive.current = true;
    setSupported(
      typeof MediaRecorder !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function",
    );
    return () => {
      alive.current = false;
      session.current++;
      request.current?.abort();
      const current = recorder.current;
      if (current) {
        current.ondataavailable = null;
        current.onstop = null;
        current.onerror = null;
      }
      if (current?.state === "recording") current.stop();
      recorder.current = null;
      release();
    };
  }, []);
  useEffect(() => {
    if (phase === "review") review.current?.focus();
  }, [phase]);
  async function start() {
    if (starting.current || disabled) return;
    starting.current = true;
    const id = ++session.current;
    setText("");
    setError("");
    setSeconds(0);
    setPhase("starting");
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || id !== session.current) {
        audio.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = audio;
      const current = new MediaRecorder(audio);
      recorder.current = current;
      let chunks: Blob[] = [];
      let bytes = 0;
      let failure = "";
      current.ondataavailable = (event) => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          failure = "too_large";
          chunks = [];
          stop();
          return;
        }
        chunks.push(event.data);
      };
      current.onerror = () => {
        failure = "microphone_failed";
        chunks = [];
        if (current.state === "recording") current.stop();
        else {
          release();
          setError(voiceErrorMessage(failure));
          setPhase("error");
        }
      };
      current.onstop = () => {
        release();
        recorder.current = null;
        if (!alive.current || id !== session.current) {
          chunks = [];
          return;
        }
        if (failure) {
          chunks = [];
          setError(voiceErrorMessage(failure));
          setPhase("error");
          return;
        }
        const blob = new Blob(chunks, { type: current.mimeType });
        chunks = [];
        setPhase("transcribing");
        const controller = new AbortController();
        request.current = controller;
        void transcribeAudio(blob, controller.signal)
          .then((transcript) => {
            if (alive.current && id === session.current) {
              setText(transcript.text);
              setPhase("review");
            }
          })
          .catch((reason: unknown) => {
            if (alive.current && id === session.current) {
              setError(
                reason instanceof Error ? reason.message : voiceErrorMessage("provider_failed"),
              );
              setPhase("error");
            }
          })
          .finally(() => {
            if (request.current === controller) request.current = null;
          });
      };
      current.start(250);
      const began = Date.now();
      ticker.current = setInterval(
        () => setSeconds(Math.min(30, Math.floor((Date.now() - began) / 1000))),
        250,
      );
      timeout.current = setTimeout(stop, 30_000);
      setPhase("recording");
    } catch (reason) {
      release();
      if (alive.current && id === session.current) {
        setError(
          voiceErrorMessage(
            reason instanceof DOMException &&
              ["NotAllowedError", "SecurityError"].includes(reason.name)
              ? "microphone_denied"
              : "microphone_failed",
          ),
        );
        setPhase("error");
      }
    } finally {
      starting.current = false;
    }
  }
  return {
    supported,
    phase,
    seconds,
    text,
    setText,
    error,
    review,
    start,
    stop,
    clear: () => {
      setText("");
      setPhase("idle");
    },
  };
}
