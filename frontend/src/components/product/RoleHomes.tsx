import { Link } from "@tanstack/react-router";
import { getEvaluation, getRadar, getRequests, type WorkItemRow } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { ACTIONS } from "@/components/gate/shared";
import { ListState, PageHeading, SampleTag, StatusBadge } from "./shared";

const gateLabel = (row: WorkItemRow) =>
  row.gates_passed === true ? "Pass" : row.gates_passed === false ? "Blocked" : "No spec gates";

function RequestLink({ row }: { row: WorkItemRow }) {
  return (
    <Link className="underline" to="/requests/$requestId" params={{ requestId: row.request_id }}>
      {row.text}
    </Link>
  );
}

// Analyst: the data behind the recommendations, across requests and the estate.
export function AnalystHome() {
  const resource = useResource(async () => {
    const [rows, radar, evaluation] = await Promise.all([
      getRequests(),
      getRadar(),
      getEvaluation(),
    ]);
    return { rows, radar, evaluation };
  });
  const data = resource.data;
  const metric = (id: string) =>
    data?.evaluation.groups.flatMap((group) => group.metrics).find((entry) => entry.id === id);
  const citations = metric("citation_validity");
  const totals = data?.radar.totals;
  const tiles = totals
    ? [
        {
          value: `${totals.kpi_status["canonical"] ?? 0} of ${totals.kpis}`,
          label: "KPI definitions that are canonical",
          to: "/radar" as const,
        },
        {
          value: String(data.radar.kpi_conflicts.length),
          label: "Metrics with conflicting definitions",
          to: "/radar" as const,
        },
        {
          value:
            citations && typeof citations.value === "number"
              ? `${Math.round(citations.value * 100)}%`
              : "Not measured",
          label: `Cited rows that exist in the data pack${citations ? ` (n=${citations.n})` : ""}`,
          to: "/evaluation" as const,
        },
        {
          value: `${totals.ownerless} of ${totals.assets}`,
          label: "Assets without an active owner",
          to: "/radar" as const,
        },
      ]
    : [];
  return (
    <>
      <PageHeading
        title="Evidence workspace"
        description="Check the data behind each recommendation: the rows it cites, the KPIs it covers and the definitions that conflict."
        action={
          <Link className="control" to="/requests" search={{ create: "1" }}>
            New request
          </Link>
        }
      />
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={false}
        retry={resource.reload}
      />
      {data && (
        <>
          <div className="mb-8 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((tile) => (
              <Link key={tile.label} className="panel" to={tile.to}>
                <p className="text-2xl font-semibold tabular-nums">{tile.value}</p>
                <p className="mt-2 text-sm">{tile.label}</p>
              </Link>
            ))}
          </div>
          <section className="mb-8">
            <h2 className="section-title">Requests and their evidence</h2>
            <div className="table-region">
              <table className="product-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Recommendation</th>
                    <th>Target</th>
                    <th>Gates</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.request_id}>
                      <td>
                        <RequestLink row={row} />
                        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {row.request_id} {row.origin === "sample" && <SampleTag />}
                        </span>
                      </td>
                      <td>{ACTIONS[row.action].label}</td>
                      <td>
                        {row.target ? <span className="font-mono">{row.target}</span> : "None"}
                        {row.target_name && (
                          <span className="block text-xs text-muted-foreground">
                            {row.target_name}
                          </span>
                        )}
                      </td>
                      <td
                        className={
                          row.gates_passed === false
                            ? "whitespace-nowrap font-semibold text-destructive"
                            : "whitespace-nowrap"
                        }
                      >
                        {gateLabel(row)}
                      </td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2 className="section-title">Conflicting KPI definitions</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The same metric defined more than once. A target must cover a requested KPI as
              primary; these variants are why many reports need repair before reuse.
            </p>
            <ul className="divide-y text-sm">
              {data.radar.kpi_conflicts.slice(0, 6).map((conflict) => (
                <li key={conflict.metric} className="py-3">
                  <p className="font-semibold">{conflict.metric}</p>
                  <p className="mt-1 text-muted-foreground">
                    {conflict.variants
                      .map(
                        (variant) =>
                          `${variant.id} ${variant.name} (${variant.status.replace(/_/g, " ")})`,
                      )
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
            <Link className="mt-3 inline-block underline" to="/radar">
              All findings in Radar
            </Link>
          </section>
        </>
      )}
    </>
  );
}

const BUILD_ACTIONS = new Set([
  "new_build",
  "extend",
  "migrate",
  "repair_and_reuse",
  "retire_and_reuse",
]);

// Developer: what to build or change, with the spec as the handoff.
export function DeveloperHome() {
  const resource = useResource(() => getRequests());
  const rows = (resource.data ?? []).filter((row) => BUILD_ACTIONS.has(row.action));
  const groups = [
    {
      title: "Approved, ready to build",
      note: "The spec is final. Build it from the JSON on the Spec tab.",
      rows: rows.filter((row) => row.status === "approved"),
    },
    {
      title: "Waiting for approval",
      note: "The spec is a draft. Gates and an owner come first.",
      rows: rows.filter(
        (row) => row.status === "awaiting_approval" || row.status === "human_review",
      ),
    },
    {
      title: "Still being clarified",
      note: "The request is not clear yet, so the spec may change.",
      rows: rows.filter((row) => row.status === "clarifying"),
    },
  ];
  return (
    <>
      <PageHeading
        title="Build queue"
        description="Dashboards to build and reports to change. Each spec names the semantic model, measures, owner and review date, and downloads as JSON: change the configuration, not the report from scratch."
      />
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={!rows.length}
        retry={resource.reload}
        emptyText="Nothing to build. Every current request reuses an existing report as it is."
      />
      {!resource.loading &&
        groups.map(
          (group) =>
            group.rows.length > 0 && (
              <section key={group.title} className="mb-8">
                <h2 className="section-title">
                  {group.title} <span className="text-muted-foreground">{group.rows.length}</span>
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">{group.note}</p>
                <div className="table-region">
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Work</th>
                        <th>Builds on</th>
                        <th>Gates</th>
                        <th>Spec</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.request_id}>
                          <td>
                            <RequestLink row={row} />
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {row.request_id}
                            </span>
                          </td>
                          <td>{ACTIONS[row.action].label}</td>
                          <td>
                            {row.target ? (
                              <>
                                <span className="font-mono">{row.target}</span>
                                {row.target_name && (
                                  <span className="block text-xs text-muted-foreground">
                                    {row.target_name}
                                  </span>
                                )}
                              </>
                            ) : (
                              "A governed semantic model"
                            )}
                          </td>
                          <td
                            className={
                              row.gates_passed === false
                                ? "whitespace-nowrap font-semibold text-destructive"
                                : "whitespace-nowrap"
                            }
                          >
                            {gateLabel(row)}
                          </td>
                          <td>
                            <Link
                              className="underline"
                              to="/requests/$requestId"
                              params={{ requestId: row.request_id }}
                            >
                              Open spec
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
        )}
    </>
  );
}
