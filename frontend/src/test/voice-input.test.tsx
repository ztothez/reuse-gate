import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "http://voice.test");
});
import { VoiceInput } from "@/components/product/VoiceInput";
import { MAX_AUDIO_BYTES, transcribeAudio, voiceErrorMessage } from "@/lib/api";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static chunk = new Blob(["audio"]);
  state = "inactive";
  mimeType = "audio/ogg;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: FakeRecorder.chunk });
    this.onstop?.();
  }
}
let fetcher: ReturnType<typeof vi.fn>;
let stopped: ReturnType<typeof vi.fn>;
let media: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.chunk = new Blob(["audio"]);
  stopped = vi.fn();
  media = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopped }] });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: media },
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ text: "A transcribed request", language: "en" })),
    );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
async function record() {
  fireEvent.click(screen.getByRole("button", { name: "Record request" }));
  await screen.findByRole("button", { name: "Stop recording" });
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
}
describe("voice push-to-talk", () => {
  it("sends the raw blob with the recorder MIME type, then requires editable confirmation", async () => {
    const onUse = vi.fn(),
      store = vi.spyOn(Storage.prototype, "setItem"),
      log = vi.spyOn(console, "log");
    render(<VoiceInput onUse={onUse} />);
    await record();
    const field = await screen.findByLabelText("Review transcript");
    expect(field).toHaveValue("A transcribed request");
    expect(field).toHaveFocus();
    expect(onUse).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://voice.test/transcribe");
    expect(init.body).toBeInstanceOf(Blob);
    expect(init.body.type).toBe("audio/ogg;codecs=opus");
    expect(init.headers).toEqual({ "Content-Type": "audio/ogg;codecs=opus" });
    fireEvent.change(field, { target: { value: "Edited and confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this text" }));
    expect(onUse).toHaveBeenCalledWith("Edited and confirmed");
    expect(screen.queryByLabelText("Review transcript")).toBeNull();
    expect(stopped).toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
  it("discards a transcript without using or persisting it", async () => {
    const onUse = vi.fn();
    render(<VoiceInput onUse={onUse} />);
    await record();
    await screen.findByLabelText("Review transcript");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Review transcript")).toBeNull();
  });
  it("auto-stops at 30 seconds and announces its recording timer", async () => {
    vi.useFakeTimers();
    render(<VoiceInput onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Recording 29s of 30s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(FakeRecorder.instances[0]!.state).toBe("inactive");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalled();
  });
  it("shows permission denial and keeps typing as the recovery", async () => {
    media.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    render(<VoiceInput onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Microphone permission was denied, please type instead",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("hides when the recording API is absent", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<VoiceInput onUse={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("hides when microphone capture is absent", () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<VoiceInput onUse={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("rejects oversized recordings without uploading", async () => {
    FakeRecorder.chunk = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]);
    render(<VoiceInput onUse={vi.fn()} />);
    await record();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The recording is too large, please type instead",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cleans up a recording on unmount", async () => {
    const view = render(<VoiceInput onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    await screen.findByRole("button", { name: "Stop recording" });
    view.unmount();
    expect(stopped).toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("releases a microphone permission result that arrives after unmount", async () => {
    let resolve!: (value: unknown) => void;
    media.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = render(<VoiceInput onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));
    view.unmount();
    await act(async () => resolve({ getTracks: () => [{ stop: stopped }] }));
    expect(stopped).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
  });
  it.each([
    "empty_audio",
    "too_large",
    "unsupported_type",
    "no_speech",
    "rate_limited",
    "not_configured",
    "permission_missing",
    "provider_failed",
    "provider_timeout",
  ])("maps %s without showing provider details", async (code) => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error: "private provider detail", code }), { status: 503 }),
    );
    await expect(transcribeAudio(new Blob(["audio"], { type: "audio/webm" }))).rejects.toThrow(
      voiceErrorMessage(code),
    );
    expect(voiceErrorMessage(code)).toMatch(/please type instead$/);
  });
  it("announces transcribing while the response is pending", async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<VoiceInput onUse={vi.fn()} />);
    await record();
    expect(screen.getByRole("status")).toHaveTextContent("Transcribing your recording");
    expect(screen.getByRole("button", { name: "Transcribing..." })).toBeDisabled();
    await act(async () =>
      resolve(new Response(JSON.stringify({ text: "Confirmed later", language: "en" }))),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Review transcript")).toHaveValue("Confirmed later"),
    );
  });
});
