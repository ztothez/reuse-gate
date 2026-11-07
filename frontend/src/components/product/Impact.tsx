import { Link } from "@tanstack/react-router";
import { getEvaluation, type Evaluation } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

// The modelled impact from GET /evaluation (group "impact"). Numbers are never hard-coded here: without the group, nothing shows.
export type Impact = Record<
  "avoided" | "requests" | "today" | "withGate" | "noCheck" | "specsToday" | "specsFixed" | "specs",
  number
>;
export function readImpact(evaluation: Evaluation | null): Impact | null {
  const metrics = evaluation?.groups.find((group) => group.group === "impact")?.metrics ?? [];
  const get = (id: string) => metrics.find((metric) => metric.id === id);
  const num = (id: string, field: "value" | "n" = "value") => {
    const value = get(id)?.[field];
    return typeof value === "number" ? value : null;
  };
  const values = {
    avoided: num("new_builds_avoided"),
    requests: num("new_builds_avoided", "n"),
    today: num("estate_assets_today"),
    withGate: num("estate_assets_with_gate"),
    noCheck: num("estate_assets_no_check"),
    specsToday: num("specs_passing_today"),
    specsFixed: num("specs_passing_after_owner_fix"),
    specs: num("specs_passing_today", "n"),
  };
  return Object.values(values).every((value) => value !== null) ? (values as Impact) : null;
}
export function useImpact() {
  const resource = useResource(getEvaluation);
  return readImpact(resource.data);
}

export function ImpactLine() {
  const impact = useImpact();
  if (!impact) return null;
  return (
    <p className="mt-4 text-sm">
      <strong>
        {impact.avoided} of {impact.requests}
      </strong>{" "}
      modelled dashboard requests avoid a new build by reusing, repairing or extending what exists.{" "}
      <Link className="underline" to="/evaluation">
        How this is measured
      </Link>
    </p>
  );
}

export function EstateComparison({ impact }: { impact: Impact }) {
  const rows = [
    { label: "Today", value: impact.today, tone: "bg-muted-foreground/40" },
    {
      label: `After ${impact.requests} requests, no check`,
      value: impact.noCheck,
      tone: "bg-muted-foreground/70",
    },
    {
      label: `After ${impact.requests} requests, with Reuse Gate`,
      value: impact.withGate,
      tone: "bg-primary",
    },
  ];
  const max = Math.max(...rows.map((row) => row.value));
  return (
    <section className="panel my-8" aria-labelledby="estate-size">
      <h2 id="estate-size" className="section-title">
        Projected estate size
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Report assets in the synthetic estate. A projection under documented assumptions, not a
        measured saving.
      </p>
      <ul className="space-y-4">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid min-w-0 gap-2 sm:grid-cols-[16rem_minmax(0,1fr)_3rem] sm:items-center"
          >
            <span className="text-sm">{row.label}</span>
            <span className="h-3 rounded-full bg-muted" aria-hidden>
              <span
                className={`block h-3 rounded-full ${row.tone}`}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>
            <span className="text-sm font-semibold tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm">
        {impact.noCheck - impact.withGate} fewer assets than building every request.{" "}
        <Link className="underline" to="/evaluation">
          Method and caveats
        </Link>
      </p>
    </section>
  );
}
