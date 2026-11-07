// Request a supported audio container instead of relying on the browser default.
const FORMATS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
];
export function isSupportedAudioType(type: string) {
  return /^audio\/(webm|ogg|mp4|wav|wave|x-wav)(\s*;|$)/i.test(type.trim());
}
export function createAudioRecorder(stream: MediaStream): MediaRecorder {
  for (const mimeType of FORMATS) {
    if (
      typeof MediaRecorder.isTypeSupported === "function" &&
      !MediaRecorder.isTypeSupported(mimeType)
    )
      continue;
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      if (!recorder.mimeType || isSupportedAudioType(recorder.mimeType)) return recorder;
    } catch {
      // A reported supported format can still fail during recorder construction.
    }
  }
  throw new DOMException("No compatible audio recording format", "NotSupportedError");
}
export function recordedAudioType(recorderType: string, chunks: Blob[]) {
  // Some recorders expose their type only on the emitted audio chunks.
  if (recorderType.trim()) return recorderType;
  return chunks.find((chunk) => chunk.type.trim())?.type ?? "";
}
