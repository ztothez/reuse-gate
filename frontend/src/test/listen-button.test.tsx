import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListenButton } from "@/components/gate/ListenButton";

const api = vi.hoisted(() => ({ speak: vi.fn(), canSpeak: vi.fn(() => true) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  ...api,
}));

const play = vi.fn(async () => {});
const pause = vi.fn();
let audio: { play: typeof play; pause: typeof pause; onended: null | (() => void) };

describe("Listen button", () => {
  beforeEach(() => {
    api.speak.mockReset().mockResolvedValue(new Blob(["x"]));
    api.canSpeak.mockReturnValue(true);
    play.mockReset().mockResolvedValue(undefined);
    pause.mockReset();
    vi.stubGlobal(
      "Audio",
      vi.fn(function Fake() {
        audio = { play, pause, onended: null };
        return audio;
      }),
    );
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("speaks the script, shows Stop, and frees the audio when stopped", async () => {
    render(<ListenButton text="Recommendation: reuse." />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("button", { name: "Stop" });
    expect(api.speak).toHaveBeenCalledWith("Recommendation: reuse.");
    expect(play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(pause).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
  });

  it("returns to Listen when the audio ends", async () => {
    render(<ListenButton text="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("button", { name: "Stop" });
    audio.onended!();
    await screen.findByRole("button", { name: "Listen" });
  });

  it("explains a failed request, keeps the page usable, and can retry", async () => {
    api.speak.mockRejectedValueOnce(new Error("503"));
    render(<ListenButton text="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Listen" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("button", { name: "Stop" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats blocked playback as a failure", async () => {
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    render(<ListenButton text="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("alert");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("stops the audio when the result is replaced", async () => {
    const { unmount } = render(<ListenButton text="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("button", { name: "Stop" });
    unmount();
    await waitFor(() => expect(pause).toHaveBeenCalled());
  });

  it("is hidden when there is no live API", () => {
    api.canSpeak.mockReturnValue(false);
    render(<ListenButton text="x" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
