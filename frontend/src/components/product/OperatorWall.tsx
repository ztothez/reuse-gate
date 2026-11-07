import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { getOperations } from "@/lib/studio";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { ListState, localDate } from "./shared";

const REFRESH_SECONDS = 60;
const SIGNALS: Record<string, string> = {
  HIGH_REACH_UNENDORSED: "Widely used, not certified",
  MISSING_OWNER: "No owner",
};

// For operators on the floor: large type, no small controls, refreshes itself. What is broken now and who owns it.
export function OperatorWall() {
  const [role] = useLens();
  const [tick, setTick] = useState(0);
  const ops = useResource(() => getOperations(), `${role}-${tick}`);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, []);
  const o = ops.data;
  const queue = o ? o.queue.awaiting_approval + o.queue.human_review : 0;
  return (
    <div className="wall">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-semibold">Operations wall</h1>
        <p className="flex items-center gap-3 text-lg text-muted-foreground" aria-live="polite">
          <RefreshCw aria-hidden className="h-6 w-6" />
          {o ? `Updated ${localDate(o.generated_at)}, refreshes every minute` : "Loading"}
        </p>
      </header>
      {!o && <ListState loading={ops.loading} error={ops.error} empty={false} retry={ops.reload} />}
      {o && (
        <>
          <dl className="mb-8 grid gap-4 md:grid-cols-4">
            {[
              ["Models failing refresh", o.failed_refresh.length, o.failed_refresh.length > 0],
              ["Reports with query errors", o.query_errors.length, o.query_errors.length > 0],
              [
                "Supply pairs at red risk",
                o.supply_risk["red"] ?? 0,
                (o.supply_risk["red"] ?? 0) > 0,
              ],
              ["Decisions waiting", queue, queue > 0],
            ].map(([k, v, bad]) => (
              <div key={String(k)} className={`panel ${bad ? "tone-amber" : ""}`}>
                <dt className="text-lg">{k}</dt>
                <dd className="mt-2 flex items-center gap-3 text-6xl font-semibold tabular-nums">
                  {bad ? (
                    <AlertTriangle aria-label="Needs attention" className="h-10 w-10" />
                  ) : (
                    <CheckCircle2 aria-label="OK" className="h-10 w-10" />
                  )}
                  {String(v)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="panel">
              <h2 className="mb-4 text-2xl font-semibold">Refresh failed: call the owner</h2>
              <ul className="divide-y text-xl">
                {o.failed_refresh.map((m) => (
                  <li key={m.id} className="flex flex-wrap justify-between gap-2 py-3">
                    <span>
                      <span className="font-semibold">{m.id}</span> {m.name}
                    </span>
                    <span className={m.owner_active ? "" : "tone-red rounded px-2"}>
                      {m.owner}
                      {m.owner_active ? "" : " (inactive)"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2 className="mb-4 text-2xl font-semibold">
                Query errors in {o.usage_month.slice(0, 7)}
              </h2>
              <ul className="divide-y text-xl">
                {o.query_errors.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 py-3">
                    <span>
                      <span className="font-semibold">{e.id}</span> {e.name}
                    </span>
                    <span className="tabular-nums">
                      {e.errors} errors · {e.owner}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2 className="mb-4 text-2xl font-semibold">Lowest on-time in-full</h2>
              <ul className="divide-y text-xl">
                {o.supply_lowest_otif.map((s) => (
                  <li
                    key={`${s.product}-${s.market}`}
                    className="flex flex-wrap justify-between gap-2 py-3"
                  >
                    <span>
                      <span className="font-semibold">{s.product}</span> {s.market}
                    </span>
                    <span className="tabular-nums">
                      {s.otif}% OTIF · {s.inventory_weeks} weeks · {s.risk} risk
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2 className="mb-4 text-2xl font-semibold">Open high-severity signals</h2>
              <ul className="divide-y text-xl">
                {Object.entries(o.open_high_signals).map(([code, n]) => (
                  <li key={code} className="flex justify-between py-3">
                    <span>{SIGNALS[code] ?? code.replace(/_/g, " ").toLowerCase()}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-lg">
                Queue: {o.queue.awaiting_approval} waiting for an approver, {o.queue.human_review}{" "}
                with a person, {o.queue.clarifying} answering questions.
              </p>
            </section>
          </div>
          <p className="mt-6 text-base text-muted-foreground">
            Sources: {o.sources.join(", ")}. Data: Bayer's synthetic data pack.
          </p>
        </>
      )}
    </div>
  );
}
