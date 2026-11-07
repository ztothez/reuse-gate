import { getEvaluation, type EvaluationMetric } from "@/lib/api";
import { displayText } from "@/lib/display-text";
import {
  EVALUATION_GROUPS,
  GROUP_LABELS,
  formatMetric,
  metricMeaning,
  modelAttribution,
} from "@/lib/evaluation";
import { useResource } from "@/lib/use-resource";
import { ListState, PageHeading, localDate } from "./shared";

function MetricRow({ metric }: { metric: EvaluationMetric }) {
  const value = formatMetric(metric);
  const models = modelAttribution(metric.method);
  return (
    <article className="min-w-0 border-b py-6 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{metric.name}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{metricMeaning(metric)}</p>
        </div>
        <div className="text-left">
          <p className="text-2xl font-semibold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            n = {metric.n.toLocaleString()}
            {metric.unit !== "share" ? ` · ${metric.unit}` : ""}
          </p>
        </div>
      </div>
      {value === "Not measured" && (
        <p className="tone-amber mt-3 rounded p-3 text-sm">
          {displayText(metric.caveat || metric.basis || "No measurement was supplied.")}
        </p>
      )}
      {models && <p className="mt-3 text-sm">{models}</p>}
      <details className="mt-3">
        <summary className="min-h-16 cursor-pointer py-4 text-sm font-semibold">
          Method and limits: {metric.name}
        </summary>
        <dl className="grid gap-4 rounded-lg bg-muted p-4 text-sm">
          {[
            ["Method", metric.method],
            ["Basis", metric.basis],
            ["Caveat", metric.caveat],
          ].map(([label, text]) => (
            <div key={label}>
              <dt className="font-semibold">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap">
                {displayText(text || "Not supplied by the API.")}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}
export function EvaluationPage() {
  const resource = useResource(getEvaluation);
  const groups = [...(resource.data?.groups ?? [])].sort((a, b) => {
    const ai = EVALUATION_GROUPS.indexOf(a.group),
      bi = EVALUATION_GROUPS.indexOf(b.group);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
  return (
    <>
      <PageHeading
        title="How we measure Reuse Gate"
        description="Measured on this data pack with author-written prompts. These checks describe this run, not general accuracy or realised business savings."
        action={
          <button className="primary-action" onClick={resource.reload} disabled={resource.loading}>
            Refresh measurements
          </button>
        }
      />
      {resource.data && (
        <div className="panel mb-6 text-sm">
          <p>Generated: {localDate(resource.data.generated_at)}</p>
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Estate snapshot: {resource.data.estate_snapshot}
          </p>
          <p className="mt-3">
            Repeated and synthetic examples, simulated answers and small samples limit what these
            scores can tell us. Inspect each method, basis and caveat before comparing results.
          </p>
        </div>
      )}
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={false}
        retry={resource.reload}
      />
      {!resource.loading && !resource.error && groups.length === 0 && (
        <p className="panel">
          No evaluation measurements were supplied. Refresh or check the API connection in Admin.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.group} className="panel mb-6">
          <h2 className="section-title">{GROUP_LABELS[group.group] ?? group.group}</h2>
          {group.metrics.length ? (
            group.metrics.map((metric) => <MetricRow key={metric.id} metric={metric} />)
          ) : (
            <p className="text-sm text-muted-foreground">
              This group has no measurements in the supplied run.
            </p>
          )}
        </section>
      ))}
    </>
  );
}
