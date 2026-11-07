import { useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { getRadar, getRequests, type RadarAsset, type WorkItemRow } from "@/lib/api";
import { displayText } from "@/lib/display-text";
import { useResource } from "@/lib/use-resource";
import { OwnershipBottlenecks } from "@/components/gate/OwnershipBottlenecks";
import { ListState, PageHeading } from "./shared";
export function RelatedRequests({ asset, rows }: { asset: RadarAsset; rows: WorkItemRow[] }) {
  const direct = rows.filter((row) => row.target === asset.id);
  return (
    <div className="space-y-2 text-xs">
      {direct.map((row) => (
        <Link
          className="request-link text-xs"
          key={row.request_id}
          to="/requests/$requestId"
          params={{ requestId: row.request_id }}
        >
          {row.text}
        </Link>
      ))}
      {!direct.length && (
        <p className="text-muted-foreground">No direct-target match in the loaded requests.</p>
      )}
      <Link to="/requests" search={{ q: asset.name }} className="request-link text-xs">
        Search related requests
      </Link>
    </div>
  );
}
export function RadarPage() {
  const search = useSearch({ from: "/radar" });
  const [sort, setSort] = useState("views");
  const resource = useResource(async () => ({
    radar: await getRadar(),
    requests: await getRequests(),
  }));
  const data = resource.data;
  const categories = [
    { key: "conflicts", title: "Conflicting KPI definitions" },
    { key: "ownerless", title: "Assets needing an active owner" },
    { key: "uncertified", title: "Uncertified high-reach assets" },
    { key: "dead", title: "Retire or review" },
  ];
  return (
    <>
      <PageHeading
        title="Governance radar"
        description="Ownership, definitions and adoption findings, with the requests you can verify behind them."
        action={
          <button className="primary-action" onClick={resource.reload}>
            Refresh findings
          </button>
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
          <OwnershipBottlenecks rows={data.radar.ownership_bottlenecks} />
          <div className="my-8 flex flex-wrap items-end gap-4">
            <div className="flex flex-wrap gap-2">
              <Link
                className={!search.finding ? "primary-action" : "control"}
                to="/radar"
                search={{}}
              >
                All findings
              </Link>
              {categories.map((category) => (
                <Link
                  key={category.key}
                  className={search.finding === category.key ? "primary-action" : "control"}
                  to="/radar"
                  search={{ finding: category.key }}
                >
                  {category.title}
                </Link>
              ))}
            </div>
            <label className="text-sm">
              Sort assets
              <select
                aria-label="Sort assets"
                className="control mt-2"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="views">Highest reach first</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>
          {(!search.finding || search.finding === "conflicts") && (
            <section className="mb-8">
              <h2 className="section-title">Conflicting KPI definitions</h2>
              {!data.radar.kpi_conflicts.length ? (
                <p className="panel">No KPI conflicts reported.</p>
              ) : (
                <div className="table-region" tabIndex={0} role="region" aria-label="KPI conflicts">
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Definitions</th>
                        <th>Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.radar.kpi_conflicts]
                        .sort((a, b) => a.metric.localeCompare(b.metric))
                        .map((conflict) => (
                          <tr key={conflict.metric}>
                            <td className="font-semibold">{conflict.metric}</td>
                            <td>
                              <details>
                                <summary className="min-h-16 cursor-pointer">
                                  {conflict.variants.length} variants
                                </summary>
                                <ul className="space-y-3 text-xs">
                                  {conflict.variants.map((variant) => (
                                    <li key={variant.id}>
                                      {variant.name} · {variant.status.replace(/_/g, " ")}
                                      <p className="text-muted-foreground">{variant.id}</p>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </td>
                            <td>
                              <Link
                                className="request-link"
                                to="/requests"
                                search={{ q: conflict.metric }}
                              >
                                Search related requests
                              </Link>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {[
            {
              key: "ownerless",
              title: "Assets needing an active owner",
              rows: data.radar.ownerless_assets,
              total: data.radar.totals.ownerless,
            },
            {
              key: "uncertified",
              title: "Uncertified high-reach assets",
              rows: data.radar.high_reach_uncertified,
              total: data.radar.totals.high_reach_uncertified,
            },
            {
              key: "dead",
              title: "Retire or review",
              rows: data.radar.dead_assets,
              total: data.radar.totals.dead_or_unused,
            },
          ]
            .filter((category) => !search.finding || search.finding === category.key)
            .map((category) => (
              <section key={category.key} className="mb-8">
                <h2 className="section-title">{category.title}</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  {category.rows.length} rows supplied by Radar, from {category.total} total
                  findings. Direct-target links are confirmed from the loaded requests; searches are
                  not dependency claims.
                </p>
                {!category.rows.length ? (
                  <p className="panel">No assets reported in this group.</p>
                ) : (
                  <div
                    className="table-region"
                    tabIndex={0}
                    role="region"
                    aria-label={category.title}
                  >
                    <table className="product-table">
                      <thead>
                        <tr>
                          <th>Asset</th>
                          <th>Reach, last 3 months</th>
                          <th>Status</th>
                          <th>Reason</th>
                          <th>Requests</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...category.rows]
                          .sort((a, b) =>
                            sort === "name"
                              ? a.name.localeCompare(b.name)
                              : sort === "status"
                                ? a.status.localeCompare(b.status)
                                : b.views_3m - a.views_3m,
                          )
                          .map((asset) => (
                            <tr key={asset.id}>
                              <td>
                                <Link
                                  className="request-link"
                                  to="/assets/$assetId"
                                  params={{ assetId: asset.id }}
                                >
                                  {asset.name}
                                </Link>
                                <p className="text-xs text-muted-foreground">{asset.id}</p>
                              </td>
                              <td>{asset.views_3m.toLocaleString()}</td>
                              <td>
                                {asset.status.replace(/_/g, " ")}
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {asset.endorsement}
                                </p>
                              </td>
                              <td>
                                {displayText(asset.reason || "No additional reason provided")}
                              </td>
                              <td>
                                <RelatedRequests asset={asset} rows={data.requests} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
        </>
      )}
    </>
  );
}
export function AssetPage({ id }: { id: string }) {
  const resource = useResource(
    async () => ({ radar: await getRadar(), requests: await getRequests() }),
    id,
  );
  const data = resource.data;
  const asset =
    data &&
    [
      ...data.radar.ownerless_assets,
      ...data.radar.high_reach_uncertified,
      ...data.radar.dead_assets,
    ].find((row) => row.id === id);
  return (
    <>
      <PageHeading
        title={asset?.name ?? "Asset findings"}
        description="The asset fields and request links actually exposed by Radar."
        action={
          <Link className="primary-action" to="/radar">
            Back to Radar
          </Link>
        }
      />
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={false}
        retry={resource.reload}
      />
      {data &&
        (asset ? (
          <div className="panel space-y-5">
            <p className="text-xs text-muted-foreground">{asset.id}</p>
            <dl className="grid gap-4 sm:grid-cols-3">
              {[
                ["Status", asset.status.replace(/_/g, " ")],
                ["Endorsement", asset.endorsement],
                ["Views in 3 months", asset.views_3m.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              {displayText(asset.reason || "No additional reason provided")}
            </p>
            <h2 className="section-title">Related requests</h2>
            <RelatedRequests asset={asset} rows={data.requests} />
            <p className="text-xs text-muted-foreground">
              This is a Radar finding, not a complete asset catalog entry. Other asset properties
              and downstream dependencies are not provided by this API.
            </p>
          </div>
        ) : (
          <p className="panel">This asset is not in the current Radar findings.</p>
        ))}
    </>
  );
}
