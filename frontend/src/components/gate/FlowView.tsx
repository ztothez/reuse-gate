import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { PipelineStage } from "@/lib/api";
import { Chip, Panel } from "./shared";

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

export function FlowView({ stages }: { stages: PipelineStage[] }) {
  const firstStop = stages.find((s) => s.status === "needs_input" || s.status === "fail");
  const [selected, setSelected] = useState((firstStop ?? stages[0])?.stage);
  const current = stages.find((s) => s.stage === selected) ?? stages[0];

  return (
    <Panel
      title="How this request was processed"
      caption="Every stage, with what went in and what came out. Select a stage to inspect it."
    >
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
