import type { Asset, RecommendResult } from "@/lib/api";
import { displayText } from "@/lib/display-text";
import { FlowView } from "@/components/gate/FlowView";

// What each data pack table contributes to a decision, for the "Supports" column.
const SUPPORTS: Record<string, string> = {
  Analytics_Assets: "Candidate report",
  Asset_Usage: "Usage, worth keeping",
  Asset_KPI_Map: "KPI coverage",
  KPI_Catalog: "KPI definition",
  Semantic_Models: "Semantic model",
  Governance_Rules: "Rule applied",
  Governance_Signals: "Risk signal",
  Lineage_Edges: "Lineage",
  Migration_Backlog: "Migration plan",
};
const BLOCKING = /fail|inactive|no owner|ownerless|deprecated|not certified|uncertified/i;

export function EvidenceTab({
  result,
  prompt,
  open,
}: {
  result: RecommendResult;
  prompt: string;
  open: boolean;
}) {
  const rec = result.recommendation;
  const coverage = rec.target?.coverage;
  return (
    <div className="space-y-6">
      <section className="panel overflow-x-auto">
        <h2 className="section-title">Cited rows ({rec.evidence.length})</h2>
        {rec.evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cited evidence for this interpretation. Recheck with the API before deciding.
          </p>
        ) : (
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-normal">Source</th>
                <th className="py-2 pr-4 font-normal">Finding</th>
                <th className="py-2 font-normal">Supports</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rec.evidence.map((entry) => (
                <tr key={entry.table + entry.id}>
                  <td className="py-3 pr-4 align-top">
                    <span className="font-mono">{entry.id}</span>
                    <span className="block text-xs text-muted-foreground">{entry.table}</span>
                  </td>
                  <td className="py-3 pr-4 align-top">{displayText(entry.note)}</td>
                  <td
                    className={`py-3 align-top ${BLOCKING.test(entry.note) ? "font-semibold text-destructive" : ""}`}
                  >
                    {BLOCKING.test(entry.note)
                      ? "Blocks release"
                      : (SUPPORTS[entry.table] ?? entry.table)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {coverage && (
        <section className="panel">
          <h2 className="section-title">KPI coverage of {rec.target?.name}</h2>
          <ul className="space-y-2 text-sm">
            {coverage.requested.map((kpi) => {
              const hit = coverage.covered.find((row) => row.kpi === kpi);
              const secondary = coverage.secondary_only?.find((row) => row.kpi === kpi);
              return (
                <li key={kpi} className="flex flex-wrap justify-between gap-2">
                  <span>{kpi}</span>
                  <span className={hit ? "" : "font-semibold"}>
                    {hit
                      ? `Primary, ${hit.definition_status} (${hit.map_id})`
                      : secondary
                        ? "Secondary only, not counted"
                        : "Missing, needs adding"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <AssetList title="Retire after the move" assets={rec.retire} note={rec.retire_note} />
      <AssetList
        title="Consolidate later"
        assets={rec.consolidate_later ?? []}
        note={rec.consolidate_note}
      />
      <section className="panel">
        <h2 className="section-title">Decision rules applied</h2>
        <ul className="space-y-2 text-sm">
          {rec.rationale.map((line) => (
            <li key={line}>{displayText(line)}</li>
          ))}
        </ul>
      </section>
      {result.pipeline && (
        <details className="panel" open={open}>
          <summary className="min-h-16 cursor-pointer font-semibold">
            From the first prompt to the decision
          </summary>
          <div
            className="max-h-[70vh] max-w-full overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Request processing flow"
          >
            <FlowView
              stages={result.pipeline}
              loop={result.loop}
              prompt={prompt}
              agentic={result.ai?.intent_source === "llm"}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function AssetList({
  title,
  assets,
  note,
}: {
  title: string;
  assets: Asset[];
  note?: string | null | undefined;
}) {
  if (!assets.length) return null;
  return (
    <section className="panel">
      <h2 className="section-title">{title}</h2>
      <ul className="divide-y text-sm">
        {assets.map((asset) => (
          <li key={asset.id} className="py-2">
            <span className="font-mono">{asset.id}</span> {asset.name}
            {asset.reason && (
              <span className="block text-xs text-muted-foreground">
                {displayText(asset.reason)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-xs text-muted-foreground">{displayText(note)}</p>}
    </section>
  );
}

type Spec = {
  title?: string;
  purpose?: string;
  semantic_model?: string | null;
  measures?: { kpi_id: string; name: string; source: string }[];
  governance?: string[];
  owner?: string | null;
  review_date?: string | null;
};
export function SpecTab({ result }: { result: RecommendResult }) {
  const stage = result.pipeline?.find((entry) => entry.stage === "Spec");
  const spec = stage?.status === "ok" ? (stage.output as Spec) : null;
  const rec = result.recommendation;
  if (!spec)
    return (
      <section className="panel space-y-3 text-sm">
        <h2 className="section-title">No new dashboard spec</h2>
        <p>
          {rec.target
            ? `This decision works on the existing report ${rec.target.name} (${rec.target.id}) instead of building a new one.`
            : "A spec is drafted only for a new build or an extension once the request is clear."}
        </p>
        {rec.repair.length > 0 && (
          <>
            <h3 className="font-semibold">Changes to make</h3>
            <ul className="list-disc space-y-1 pl-5">
              {rec.repair.map((repair, index) => (
                <li key={index}>
                  {displayText(
                    typeof repair === "string"
                      ? repair
                      : `${repair.name}: ${repair.reason ?? "review required"}`,
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    );
  return (
    <section className="panel space-y-5 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Draft spec, final only after approval
        </p>
        <h2 className="mt-1 text-xl font-semibold">{spec.title}</h2>
        <p className="mt-2">{spec.purpose}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Semantic model</dt>
          <dd className="font-mono">{spec.semantic_model ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Owner</dt>
          <dd>{spec.owner ?? "Required before release"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Review date</dt>
          <dd>{spec.review_date ?? "Required"}</dd>
        </div>
      </dl>
      {spec.measures?.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-normal">Measure</th>
              <th className="py-2 pr-4 font-normal">KPI</th>
              <th className="py-2 font-normal">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {spec.measures.map((measure) => (
              <tr key={measure.kpi_id}>
                <td className="py-2 pr-4">{measure.name}</td>
                <td className="py-2 pr-4 font-mono">{measure.kpi_id}</td>
                <td className="py-2">{measure.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {spec.governance?.length ? (
        <div>
          <h3 className="font-semibold">Governance built in</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {spec.governance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details>
        <summary className="min-h-16 cursor-pointer font-semibold">
          Spec as JSON (the handoff to the BI build)
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-4 text-xs">
          {JSON.stringify(spec, null, 2)}
        </pre>
      </details>
    </section>
  );
}
