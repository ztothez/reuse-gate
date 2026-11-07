import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ClarificationLoop, LoopRound, PipelineStage } from "@/lib/api";
import { Chip, Panel } from "./shared";

// Bayer's reference legend.
const ROLES = {
  user_input: { label: "User input", tone: "tone-orange" },
  agentic: { label: "Agentic skill", tone: "tone-yellow" },
  deterministic: { label: "Deterministic Python", tone: "tone-green" },
  state: { label: "Process state", tone: "tone-blue" },
};
type Role = keyof typeof ROLES;

function RolePill({ role }: { role: Role }) {
  return (
    <span
      className={`${ROLES[role].tone} inline-flex rounded border px-1.5 text-[11px] font-medium`}
    >
      {ROLES[role].label}
    </span>
  );
}

const STATUS: Record<PipelineStage["status"], { label: string; tone: string }> = {
  ok: { label: "Done", tone: "tone-green" },
  pass: { label: "Passed", tone: "tone-green" },
  needs_input: { label: "Needs input", tone: "tone-amber" },
  fail: { label: "Blocked", tone: "tone-red" },
  skipped: { label: "Skipped", tone: "tone-gray" },
};

const label = (key: string) => key.replace(/_/g, " ");

function Fields({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="space-y-2">
      {Object.entries(value).map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{label(k)}</dt>
          <dd className="mt-0.5 break-words">
            <Value value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="text-muted-foreground">none</span>;
  if (typeof value === "boolean")
    return (
      <span
        className={`${value ? "tone-green" : "tone-red"} inline-flex rounded-full border px-2 text-xs font-medium`}
      >
        {value ? "yes" : "no"}
      </span>
    );
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">none</span>;
    if (value.every((x) => typeof x === "object" && x !== null)) {
      return (
        <ul className="space-y-2">
          {value.map((x, i) => (
            <li key={i} className="rounded-md border p-2">
              <Fields value={x as Record<string, unknown>} />
            </li>
          ))}
        </ul>
      );
    }
    if (value.every((x) => String(x).length <= 40)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((x) => (
            <Chip key={String(x)}>{String(x)}</Chip>
          ))}
        </span>
      );
    }
    return (
      <ul className="list-disc space-y-1 pl-4">
        {value.map((x, i) => (
          <li key={i}>{String(x)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") return <Fields value={value as Record<string, unknown>} />;
  return <span>{String(value)}</span>;
}

const shown = (value: unknown) =>
  value === null || value === undefined || (Array.isArray(value) && value.length === 0)
    ? "none"
    : Array.isArray(value)
      ? value.join(", ")
      : String(value);

function Round({ round }: { round: LoopRound }) {
  return (
    <li className="rounded-md border p-3" aria-label={`Round ${round.round}`}>
      <p className="font-semibold">Round {round.round}</p>
      <ul className="mt-2 space-y-2">
        {round.questions.map((q) => {
          const answer = round.answers.find((a) => a.field === q.field && a.question === q.text);
          return (
            <li key={q.text}>
              <p>{q.phrased ?? q.text}</p>
              <p className="text-muted-foreground">
                Answer: {answer ? answer.answer : "waiting for the requester"}
                {answer && answer.used === false ? " (could not be used)" : ""}
              </p>
            </li>
          );
        })}
      </ul>
      {round.answers.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">Intent change in this round</p>
          {round.changed.length === 0 ? (
            <p>No change</p>
          ) : (
            <ul>
              {round.changed.map((c) => (
                <li key={c.field}>
                  <span className="font-medium">{c.field.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-muted-foreground line-through">{shown(c.from)}</span>{" "}
                  <ArrowRight className="inline h-3 w-3" aria-label="changed to" /> {shown(c.to)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

const LOOP_STATUS: Record<ClarificationLoop["status"], { label: string; tone: string }> = {
  clear: { label: "Intent clear", tone: "tone-green" },
  asking: { label: "Waiting for answers", tone: "tone-amber" },
  human_review: { label: "Sent to a person", tone: "tone-red" },
};

function LoopPanel({ loop }: { loop: ClarificationLoop }) {
  return (
    <section aria-label="Clarification loop" className="mt-4 rounded-md border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">
          Clarification loop: {loop.rounds_used} of {loop.max_rounds} rounds used
        </h4>
        <span
          className={`${LOOP_STATUS[loop.status].tone} rounded-full border px-2 text-xs font-medium`}
        >
          {LOOP_STATUS[loop.status].label}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Rules choose what to ask.
        {loop.phrased_by ? ` ${loop.phrased_by} reworded the questions.` : ""}
        {loop.stopped_because ? ` Stopped: ${loop.stopped_because}.` : ""}
      </p>
      <dl className="mt-3 flex flex-wrap gap-2" aria-label="Confidence per field">
        {Object.entries(loop.confidence).map(([field, c]) => (
          <div
            key={field}
            className={`${c.score >= loop.clear_at ? "tone-green" : "tone-amber"} rounded border px-2 py-0.5 text-xs`}
          >
            <dt className="inline font-medium">{field} </dt>
            <dd className="inline tabular-nums">
              {Math.round(c.score * 100)}% ({c.basis.replace(/_/g, " ")})
            </dd>
          </div>
        ))}
      </dl>
      {loop.rounds.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {loop.rounds.map((r) => (
            <Round key={r.round} round={r} />
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-muted-foreground">No questions were needed.</p>
      )}
    </section>
  );
}

export function FlowView({
  stages,
  loop,
  prompt,
  agentic = false,
}: {
  stages: PipelineStage[];
  loop?: ClarificationLoop | undefined;
  prompt?: string;
  agentic?: boolean;
}) {
  const firstStop = stages.find((s) => s.status === "needs_input" || s.status === "fail");
  const [selected, setSelected] = useState((firstStop ?? stages[0])?.stage);
  const current = stages.find((s) => s.stage === selected) ?? stages[0];

  return (
    <Panel
      title="How this request was processed"
      caption="Every stage, with what went in and what came out. Select a stage to inspect it."
    >
      <ul className="mb-3 flex flex-wrap gap-2" aria-label="Legend">
        {(Object.keys(ROLES) as Role[]).map((role) => (
          <li key={role}>
            <RolePill role={role} />
          </li>
        ))}
      </ul>
      {prompt !== undefined && loop && (
        <ol className="mb-2 flex flex-wrap items-stretch gap-2" aria-label="Prompt to Intent">
          <li className="flex-1 rounded-md border p-3" style={{ minWidth: "14rem" }}>
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">Prompt</span>
              <RolePill role="user_input" />
            </span>
            <span className="mt-1 block break-words text-xs text-muted-foreground">{prompt}</span>
          </li>
          <li className="flex-1 rounded-md border p-3" style={{ minWidth: "14rem" }}>
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">Clarification loop</span>
              <RolePill role={agentic || loop.phrased_by ? "agentic" : "deterministic"} />
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {loop.rounds_used} of {loop.max_rounds} rounds,{" "}
              {LOOP_STATUS[loop.status].label.toLowerCase()}.
              {agentic || loop.phrased_by
                ? " A model read or reworded; rules decide."
                : " Rules only."}
            </span>
          </li>
        </ol>
      )}
      <ol className="flex flex-wrap items-stretch gap-2" aria-label="Pipeline stages">
        {stages.map((s, i) => (
          <li key={s.stage} className="flex min-w-36 flex-1 items-center gap-2">
            <button
              type="button"
              aria-pressed={s.stage === selected}
              onClick={() => setSelected(s.stage)}
              className={`h-full w-full rounded-md border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${s.stage === selected ? "border-primary ring-1 ring-primary" : "hover:border-primary"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{s.stage}</span>
                <span
                  className={`${STATUS[s.status].tone} rounded-full border px-2 text-xs font-medium`}
                >
                  {STATUS[s.status].label}
                </span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{s.summary}</span>
              {s.role && (
                <span className="mt-2 flex flex-wrap gap-1">
                  <RolePill role={s.role} />
                  {s.stage === "Decision" && (
                    <span className="tone-indigo inline-flex rounded border px-1.5 text-[11px] font-medium">
                      Our addition
                    </span>
                  )}
                </span>
              )}
            </button>
            {i < stages.length - 1 && (
              <ArrowRight
                className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
      {loop && <LoopPanel loop={loop} />}
      {current && (
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <section aria-label={`${current.stage} input`} className="rounded-md border p-4">
            <h4 className="mb-2 font-semibold">Input</h4>
            <div className="max-h-96 overflow-auto">
              <Fields value={current.input} />
            </div>
          </section>
          <section aria-label={`${current.stage} output`} className="rounded-md border p-4">
            <h4 className="mb-2 font-semibold">Output</h4>
            <div className="max-h-96 overflow-auto">
              <Fields value={current.output} />
            </div>
          </section>
        </div>
      )}
    </Panel>
  );
}
