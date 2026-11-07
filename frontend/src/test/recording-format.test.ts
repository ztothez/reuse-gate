import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAudioRecorder,
  isSupportedAudioType,
  recordedAudioType,
} from "@/lib/recording-format";
afterEach(() => vi.unstubAllGlobals());
const stream = {} as MediaStream;
function recorderFor(supports: (type: string) => boolean, rejected?: string) {
  const constructed: string[] = [];
  class Recorder {
    static isTypeSupported = supports;
    mimeType: string;
    constructor(_stream: MediaStream, options: MediaRecorderOptions) {
      constructed.push(options.mimeType!);
      if (options.mimeType === rejected) throw new DOMException("Rejected", "NotSupportedError");
      this.mimeType = options.mimeType!;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  return constructed;
}
describe("recording format negotiation", () => {
  it("requests an audio container instead of using the browser's default", () => {
    const calls = recorderFor((type) => type.startsWith("audio/webm"));
    expect(createAudioRecorder(stream).mimeType).toBe("audio/webm;codecs=opus");
    expect(calls).toEqual(["audio/webm;codecs=opus"]);
  });
  it("selects MP4 when that is the only supported audio format", () => {
    const calls = recorderFor((type) => type === "audio/mp4");
    expect(createAudioRecorder(stream).mimeType).toBe("audio/mp4");
    expect(calls).toEqual(["audio/mp4"]);
  });
  it("tries another supported format if construction fails", () => {
    recorderFor(
      (type) => ["audio/webm;codecs=opus", "audio/ogg"].includes(type),
      "audio/webm;codecs=opus",
    );
    expect(createAudioRecorder(stream).mimeType).toBe("audio/ogg");
  });
  it("does not start an unsupported recording", () => {
    const calls = recorderFor(() => false);
    expect(() => createAudioRecorder(stream)).toThrow("No compatible audio recording format");
    expect(calls).toEqual([]);
  });
  it("uses the emitted MIME type when the recorder property is empty", () => {
    expect(recordedAudioType("", [new Blob(["audio"], { type: "audio/mp4" })])).toBe("audio/mp4");
    expect(
      recordedAudioType("audio/webm;codecs=opus", [new Blob(["audio"], { type: "audio/webm" })]),
    ).toBe("audio/webm;codecs=opus");
  });
  it("accepts the server's WAV types without relabelling other containers", () => {
    for (const type of [
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/webm;codecs=opus",
      "audio/mp4",
    ])
      expect(isSupportedAudioType(type)).toBe(true);
    expect(isSupportedAudioType("video/webm")).toBe(false);
    expect(isSupportedAudioType("")).toBe(false);
    expect(recordedAudioType("video/webm", [new Blob(["audio"], { type: "audio/webm" })])).toBe(
      "video/webm",
    );
  });
});
