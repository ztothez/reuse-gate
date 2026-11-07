import { displayText } from "@/lib/display-text";
import { useState } from "react";
import type { Answer } from "@/lib/api";
import { plainAnswer } from "@/lib/summaries";
import { openQuestions, type RequestState } from "@/lib/use-request";
import { ACTIONS } from "./shared";
import { ListenButton } from "./ListenButton";

// Glove-friendly controls: at least 64px tall, 20px text, a thick visible focus ring.
const BIG =
  "min-h-16 rounded-lg border-2 px-8 text-xl font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BIG} border-primary bg-primary text-primary-foreground`;
const SECONDARY = `${BIG} border-foreground bg-background text-foreground`;

export function RequesterView({ state }: { state: RequestState }) {
  const { text, setText, loading, error, result, rechecking, submit, recheck, accepted } = state;
  const [answer, setAnswer] = useState("");
  // Every open question is one round of the loop, so all of them are collected before one check.
  const [collected, setCollected] = useState<Answer[]>([]);
  const questions = result ? openQuestions(result) : [];
  const question = questions[collected.length];
  const target = result && !question ? result.recommendation.target : null;
  const meta = result ? ACTIONS[result.recommendation.action] ?? ACTIONS.human_review : null;
  const Icon = meta?.icon;
  const busy = loading || rechecking;
  const value = question ? answer : text;

  const sentence = busy
    ? "Checking existing reports..."
    : error
      ? error
      : !result
        ? "Tell us what report you need. We check existing reports before anything new is built."
        : question
          ? questions.length > 1
            ? `Question ${collected.length + 1} of ${questions.length}: ${question.phrased ?? question.text}`
            : question.phrased ?? question.text
          : displayText(plainAnswer(result));

  async function send(confirmedAnswer?: string) {
    if (busy || !(confirmedAnswer ?? value).trim()) return;
    if (question) {
      const all = [
        ...collected,
        { field: question.field, question: question.text, answer: (confirmedAnswer ?? answer).trim() },
      ];
      setAnswer("");
      if (all.length < questions.length) return setCollected(all);
      setCollected([]);
      await recheck(all);
    } else {
      await submit();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 text-xl text-foreground">
      {state.outdated && <p role="alert">Outdated result. Check the edited request again.</p>}
      {/* 1. The answer, in one sentence */}
      <section aria-label="Answer" className="rounded-lg border border-border bg-card p-6 sm:p-8">
        {result && !question && !busy && meta && Icon && <div className="mb-5 flex items-center gap-4 text-primary"><Icon aria-hidden className="h-12 w-12 shrink-0" /><h2 className="text-2xl font-semibold sm:text-3xl">{result.recommendation.action === "human_review" ? "Human review required" : meta.label}</h2></div>}
        {question && <h2 className="mb-3 text-xl font-semibold">Please confirm</h2>}
        <p
          aria-live="polite"
          role={error ? "alert" : undefined}
          className={result && !question ? "text-xl leading-relaxed" : "text-2xl font-semibold leading-snug sm:text-3xl"}
        >
          {sentence}
        </p>
        {result?.ai?.speech && !question && !busy && (
          <ListenButton key={result.ai.speech} text={result.ai.speech} large />
        )}

      {/* 2. The report to use */}
      {target && !busy && (
        <section
          aria-label="Report to use"
          className="mt-6 border-t pt-6"
        >
          <p className="text-xl">Report to use</p>
          <p className="mt-1 text-3xl font-bold leading-tight">{target.name}</p>
          {accepted ? (
            <p
              role="status"
              className="mt-5 rounded-lg border-2 border-foreground bg-background p-5 text-xl font-semibold"
            >
              Done. Your approver will confirm access to {target.name}.
            </p>
          ) : (
            <button
              type="button"
              className={`${PRIMARY} mt-5 min-h-20 w-full text-2xl`}
              disabled={!!state.outdated}
              onClick={() => state.setAccepted(true)}
            >
              Use this
            </button>
          )}
        </section>
      )}

      </section>

      {/* 3. The request box. Enter sends, Shift+Enter adds a new line. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="space-y-4"
      >
        <label htmlFor="requester-box" className="block text-xl font-semibold">
          {question ? "Your answer" : "What report do you need?"}
        </label>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row">
        <textarea
          id="requester-box"
          aria-describedby="requester-hint"
          value={value}
          onChange={(e) => (question ? setAnswer(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          className="block min-h-32 w-full rounded-lg border-2 border-foreground bg-background p-4 text-xl text-foreground placeholder:text-foreground/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
          placeholder={
            question
              ? "Type your answer"
              : "For example: Xarelto net sales by country, monthly"
          }
        />
        {question && (question.field.toLowerCase() === "market" || /market/i.test(question.text)) && (
          <button type="button" className={`${PRIMARY} shrink-0 sm:max-w-52`} disabled={busy} onClick={() => void send("Global")}>Yes, use Global</button>
        )}
        </div>
        <p id="requester-hint" className="text-xl">
          Press Enter to send.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" className={`${PRIMARY} sm:flex-1`} disabled={busy || !value.trim()}>
            {busy ? "Checking..." : question ? "Send answer" : "Check"}
          </button>
          {result && (
            <button
              type="button"
              className={SECONDARY}
              disabled={busy}
              onClick={() => {
                setAnswer("");
                setCollected([]);
                state.reset();
              }}
            >
              New request
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
