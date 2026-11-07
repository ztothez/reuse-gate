import { Mic, Square } from "lucide-react";
import { useVoiceInput } from "@/lib/use-voice-input";
export function VoiceInput({
  onUse,
  disabled = false,
}: {
  onUse: (text: string) => void;
  disabled?: boolean;
}) {
  const { supported, phase, seconds, text, setText, error, review, start, stop, clear } =
    useVoiceInput(disabled);
  if (!supported) return null;
  return (
    <div className="min-w-0 space-y-3">
      <button
        type="button"
        className="control min-h-16"
        aria-pressed={phase === "recording"}
        disabled={
          (disabled && phase !== "recording") ||
          phase === "starting" ||
          phase === "transcribing" ||
          phase === "review"
        }
        onClick={() => (phase === "recording" ? stop() : void start())}
      >
        {phase === "recording" ? (
          <Square aria-hidden className="h-5 w-5" />
        ) : (
          <Mic aria-hidden className="h-5 w-5" />
        )}
        {phase === "recording"
          ? "Stop recording"
          : phase === "starting"
            ? "Opening microphone..."
            : phase === "transcribing"
              ? "Transcribing..."
              : "Record request"}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {phase === "recording"
          ? `Recording ${seconds}s of 30s. Press Stop recording when finished.`
          : phase === "transcribing"
            ? "Transcribing your recording. Typing is still available."
            : phase === "review"
              ? "Review and edit the transcript before using it."
              : "Optional voice input. Stops at 30 seconds. You can always type."}
      </p>
      {phase === "error" && (
        <p role="alert" className="tone-red rounded p-3 text-sm">
          {error}
        </p>
      )}
      {phase === "review" && (
        <div className="rounded-lg border p-4">
          <label htmlFor="voice-transcript" className="mb-2 block text-sm font-semibold">
            Review transcript
          </label>
          <textarea
            ref={review}
            id="voice-transcript"
            className="control min-h-32 w-full"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
          />
          <p className="my-3 text-sm text-muted-foreground">
            Use this text replaces the request text. Nothing is submitted until you create the
            request.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="primary-action"
              disabled={!text.trim() || disabled}
              onClick={() => {
                onUse(text.trim());
                clear();
                document.getElementById("new-request-text")?.focus();
              }}
            >
              Use this text
            </button>
            <button
              type="button"
              className="control"
              onClick={() => {
                clear();
                document.getElementById("new-request-text")?.focus();
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
