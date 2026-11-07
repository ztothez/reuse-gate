import { useState } from "react";
import { Bot, Send } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { localDate } from "./shared";

export interface ChatMessage {
  id: string;
  request_id: string;
  author: string;
  role: string;
  text: string;
  time: string;
  source: "person" | "llm" | "rules" | "rules_guard";
  tier?: string | null;
}

const SOURCE: Record<string, string> = {
  llm: "worded by a model from this request's facts, checked by the faithfulness guard",
  rules: "from the rules: no model was used",
  rules_guard:
    "from the rules: the model's wording mentioned a fact not in this request, so it was replaced",
};

// The request's discussion: the people who may see it, and the agent, which answers only from this request's facts.
export function RequestChat({ id }: { id: string }) {
  const thread = useResource(
    () => apiGet<ChatMessage[]>(`/requests/${encodeURIComponent(id)}/chat`),
    id,
  );
  const [text, setText] = useState("");
  const [askAgent, setAskAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    apiPost<ChatMessage[]>(`/requests/${encodeURIComponent(id)}/chat`, {
      message: text,
      ask_agent: askAgent,
    })
      .then(() => {
        setText("");
        thread.reload();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Not sent."))
      .finally(() => setBusy(false));
  };
  return (
    <section className="panel mt-8" aria-label="Discussion">
      <h2 className="section-title">Discussion</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Everyone who can open this request sees this thread. Ask the agent why, which gates block,
        who owns it or what happens next. It answers from this request only and cannot approve or
        change anything.
      </p>
      {thread.error && (
        <p role="alert" className="tone-red rounded p-3 text-sm">
          {thread.error}
        </p>
      )}
      <ol className="mb-4 space-y-3">
        {(thread.data ?? []).map((m) => (
          <li key={m.id} className={`rounded border p-3 ${m.role === "agent" ? "tone-blue" : ""}`}>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {m.role === "agent" && <Bot aria-hidden className="h-4 w-4" />}
              <span className="font-semibold text-foreground">{m.author}</span>
              {m.role !== "agent" && <span>{m.role}</span>}
              <span>{localDate(m.time)}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap">{m.text}</p>
            {m.role === "agent" && SOURCE[m.source] && (
              <p className="mt-1 text-xs text-muted-foreground">
                Answer {SOURCE[m.source]}
                {m.tier ? ` (${m.tier})` : ""}.
              </p>
            )}
          </li>
        ))}
        {!thread.loading && !thread.error && !thread.data?.length && (
          <li className="text-sm text-muted-foreground">No messages yet.</li>
        )}
      </ol>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor={`chat-${id}`} className="block text-sm font-semibold">
          Message
        </label>
        <textarea
          id={`chat-${id}`}
          className="control w-full"
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Which gates block release?"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={askAgent}
              onChange={(e) => setAskAgent(e.target.checked)}
            />
            Ask the agent
          </label>
          <button className="primary-action" disabled={busy || !text.trim()}>
            <Send aria-hidden className="h-4 w-4" /> {busy ? "Sending..." : "Send"}
          </button>
        </div>
        {error && (
          <p role="alert" className="tone-red rounded p-3 text-sm">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
