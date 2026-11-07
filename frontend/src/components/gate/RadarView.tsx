import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getRadar, type Radar, type RadarAsset } from "@/lib/api";
import { Chip, EmptyState, Endorsement, ErrorState, Panel } from "./shared";

const STATUS_ORDER = ["canonical", "duplicate_candidate", "definition_conflict", "local_variant"];
const STATUS_TONE: Record<string, string> = {
  canonical: "bg-tone-green",
  duplicate_candidate: "bg-tone-amber",
  definition_conflict: "bg-tone-red",
  local_variant: "bg-tone-gray",
};

function AssetList({
  title,
  rows,
  queue,
  onQueue,
  showReason = false,
}: {
  title: string;
  rows: RadarAsset[];
  queue: Set<string>;
  onQueue: (id: string) => void;
  showReason?: boolean;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <EmptyState>Nothing to flag here.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">ID</th>
                <th className="pr-3">Name</th>
                <th className="pr-3 text-right">Views (3m)</th>
                <th className="px-3">Endorsement</th>
                <th className="pr-3">Status</th>
                {showReason && <th className="pr-3">Reason</th>}
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="py-2 pr-3 font-mono text-xs">{a.id}</td>
                  <td className="pr-3">{a.name}</td>
                  <td className="pr-3 text-right tabular-nums">{a.views_3m.toLocaleString()}</td>
                  <td className="px-3">
                    <Endorsement value={a.endorsement} />
                  </td>
                  <td className="pr-3">{a.status.replace(/_/g, " ")}</td>
                  {showReason && <td className="pr-3 text-muted-foreground">{a.reason || "-"}</td>}
                  <td className="py-1 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={queue.has(a.id)}
                      onClick={() => onQueue(a.id)}
                    >
                      {queue.has(a.id) ? "In queue" : "Start review"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function RadarView() {
  const [radar, setRadar] = useState<Radar | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Set<string>>(new Set());

  useEffect(() => {
    getRadar()
      .then(setRadar)
      .catch(() => setError(true));
  }, []);

  if (error) return <ErrorState>The radar could not be loaded.</ErrorState>;
  if (!radar)
    return (
      <div role="status" className="flex items-center gap-3 p-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading radar…
      </div>
    );

  const t = radar.totals;
  const tiles = [
    ["Assets", t.assets],
    ["KPI definitions", t.kpis],
    ["Ownerless assets", t.ownerless],
    ["High reach, uncertified", t.high_reach_uncertified],
    ["Retire or review", t.dead_or_unused],
  ] as const;
  const max = Math.max(...Object.values(t.kpi_status), 1);
  const toggle = (m: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(m) ? n.delete(m) : n.add(m);
      return n;
    });
  const addQ = (id: string) => setQueue((s) => new Set(s).add(id));

  return (
    <div className="space-y-6">
      {queue.size > 0 && (
        <div
          role="status"
          className="tone-blue flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
        >
          <span className="font-medium">Review queue ({queue.size}):</span>
          {[...queue].map((id) => (
            <Chip key={id} mono>
              {id}
            </Chip>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card p-4 shadow-panel">
            <p className="text-3xl font-semibold tabular-nums">{v}</p>
            <p className="mt-1 text-sm text-muted-foreground">{k}</p>
          </div>
        ))}
      </div>

      <Panel title="KPI definition status">
        <div className="space-y-2" role="list">
          {STATUS_ORDER.filter((s) => s in t.kpi_status).map((s) => (
            <div key={s} role="listitem" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm">
              <span className="min-w-0 break-words">{s.replace(/_/g, " ")}</span>
              <div className="min-w-0 h-7 flex-1 rounded bg-muted">
                <div
                  className={`${STATUS_TONE[s]} flex h-7 items-center rounded px-2 text-xs font-semibold text-primary-foreground`}
                  style={{ width: `${Math.max(((t.kpi_status[s] ?? 0) / max) * 100, 8)}%` }}
                >
                  {t.kpi_status[s]}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Legend: these are the definition_status values from the synthetic KPI catalog: canonical,
          duplicate candidate, definition conflict, and local variant.
        </p>
      </Panel>

      <Panel title="Conflicting KPI definitions">
        {radar.kpi_conflicts.length === 0 ? (
          <EmptyState>No conflicts found.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2">Metric</th>
                <th className="text-right">Variants</th>
              </tr>
            </thead>
            <tbody>
              {radar.kpi_conflicts.map((c) => (
                <Fragment key={c.metric}>
                  <tr className="border-t">
                    <td className="py-1">
                      <button
                        onClick={() => toggle(c.metric)}
                        aria-expanded={open.has(c.metric)}
                        className="flex items-center gap-1 rounded py-1 font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {open.has(c.metric) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}{" "}
                        {c.metric}
                      </button>
                    </td>
                    <td className="text-right tabular-nums">{c.variants.length}</td>
                  </tr>
                  {open.has(c.metric) &&
                    c.variants.map((v) => (
                      <tr key={v.id} className="bg-muted/50 text-xs">
                        <td className="py-1.5 pl-6">
                          <span className="font-mono">{v.id}</span> · {v.name}
                        </td>
                        <td className="pr-1 text-right">{v.status.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <AssetList
        title="Ownerless assets"
        rows={radar.ownerless_assets}
        queue={queue}
        onQueue={addQ}
      />
      <AssetList
        title="High reach but not certified"
        rows={radar.high_reach_uncertified}
        queue={queue}
        onQueue={addQ}
      />
      <AssetList
        title="Retire or review"
        rows={radar.dead_assets}
        queue={queue}
        onQueue={addQ}
        showReason
      />
    </div>
  );
}
