import { useEffect, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canSpeak, speak } from "@/lib/api";

export function ListenButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [failed, setFailed] = useState(false);
  const player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);

  function stop() {
    if (player.current) {
      player.current.audio.pause();
      URL.revokeObjectURL(player.current.url);
      player.current = null;
    }
    setState("idle");
  }
  useEffect(() => stop, []);

  async function listen() {
    if (state === "playing") return stop();
    setState("loading"); setFailed(false);
    try {
      const url = URL.createObjectURL(await speak(text));
      const audio = new Audio(url);
      player.current = { audio, url };
      audio.onended = stop;
      await audio.play();
      setState("playing");
    } catch {
      stop();
      setFailed(true);
    }
  }

  if (!canSpeak()) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={state === "loading"} onClick={listen}>
        {state === "loading" ? <Loader2 className="animate-spin" /> : state === "playing" ? <Square /> : <Volume2 />}
        {state === "playing" ? "Stop" : "Listen"}
      </Button>
      {failed && <p role="alert" className="text-sm text-muted-foreground">Audio is not available right now. The text above is complete.</p>}
    </div>
  );
}
