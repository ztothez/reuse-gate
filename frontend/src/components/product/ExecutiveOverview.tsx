import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  findModelRequest,
  getOwners,
  getRadar,
  getRequests,
  isDemo,
  remediate,
  type WorkItemRow,
} from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { ACTIONS } from "@/components/gate/shared";
import { GateComparison } from "@/components/gate/GateComparison";
import { OwnershipBottlenecks } from "@/components/gate/OwnershipBottlenecks";
import type { RemediationResult } from "@/lib/api";
import { ListState, PageHeading } from "./shared";
export function ExecutiveOverview() {
  const resource = useResource(async () => {
    const requests = await getRequests();
    return {
      requests,
      radar: await getRadar(),
      modelRequest: await findModelRequest(requests, "SM-065"),
    };
  });
  const [samples, setSamples] = useState(true);
  const data = resource.data;
  const rows = (data?.requests ?? []).filter((row) => samples || row.origin !== "sample");
  const actionable = rows.filter((row) => row.action !== "human_review");
  const reuse = actionable.filter((row) => row.action !== "new_build");
  const awaiting = rows.filter(
    (row) => row.status === "awaiting_approval" || row.status === "human_review",
  );
  const bottleneck = data?.radar.ownership_bottlenecks?.find((owner) =>
    owner.semantic_models.includes("SM-065"),
  );
  const modelRequest =
    data?.modelRequest && rows.some((row) => row.request_id === data.modelRequest?.request_id)
      ? data.modelRequest
      : null;
  return (
    <>
      <PageHeading
        title="Executive overview"
        description="Are we building less and better? Start with the demand and governance evidence available today."
        action={
          <Link className="primary-action" to="/requests">
            Explore requests
          </Link>
        }
      />
      <label className="mb-6 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={samples}
          onChange={(event) => setSamples(event.target.checked)}
        />
        Include clearly tagged sample requests
      </label>
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={false}
        retry={resource.reload}
      />
      {data && (
        <>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link
              className="panel"
              to="/requests"
              search={{ action: "existing", ...(samples ? {} : { origin: "user" }) }}
            >
              <p className="text-3xl font-semibold">
                {actionable.length
                  ? `${Math.round((reuse.length / actionable.length) * 100)}%`
                  : "Not measured"}
              </p>
              <h2 className="mt-3 font-semibold">Proposed routes avoiding a new build</h2>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {reuse.length} of {actionable.length} actionable recommendations in the returned
                list. Includes unconfirmed requests; this is not realised savings.
              </p>
            </Link>
            <Link className="panel" to="/approvals">
              <p className="text-3xl font-semibold">{awaiting.length}</p>
              <h2 className="mt-3 font-semibold">Requests awaiting a decision</h2>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Awaiting approval or human review in {rows.length} returned requests, capped at 200.{" "}
                {samples ? "Includes samples." : "Excludes samples."}
              </p>
            </Link>
            <Link className="panel" to="/radar" search={{ finding: "ownerless" }}>
              <p className="text-3xl font-semibold">{data.radar.totals.ownerless}</p>
              <h2 className="mt-3 font-semibold">Assets needing an active owner</h2>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Radar total for ownerless or inactive ownership. An ownership blocker, not a count
                of reports repaired.
              </p>
            </Link>
            <Link className="panel" to="/radar" search={{ finding: "uncertified" }}>
              <p className="text-3xl font-semibold">{data.radar.totals.high_reach_uncertified}</p>
              <h2 className="mt-3 font-semibold">High-reach assets without certification</h2>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Radar measures asset certification. Certified-owner status is not reported and
                cannot be measured from this API.
              </p>
            </Link>
          </div>
          <section className="panel my-8">
            <h2 className="section-title">What the current recommendations suggest</h2>
            <p className="mb-5 text-sm text-muted-foreground">
              A breakdown of {rows.length} loaded requests, including{" "}
              {rows.filter((row) => row.origin === "sample").length} samples. These are proposed
              routes, not delivered outcomes.
            </p>
            {!rows.length ? (
              <p>No requests in this scope. Change the sample filter to inspect the examples.</p>
            ) : (
              <ul className="space-y-4">
                {Object.entries(ACTIONS).flatMap(([action, meta]) => {
                  const count = rows.filter((row) => row.action === action).length;
                  return count
                    ? [
                        <li key={action}>
                          <Link
                            to="/requests"
                            search={{ action, ...(samples ? {} : { origin: "user" }) }}
                            className="flex min-h-16 items-center justify-between gap-4 text-sm font-medium"
                          >
                            <span>{meta.label}</span>
                            <span>{count}</span>
                          </Link>
                          <div aria-hidden="true" className="h-2 rounded bg-muted">
                            <div
                              className="h-full rounded bg-primary"
                              style={{ width: `${(count / rows.length) * 100}%` }}
                            />
                          </div>
                        </li>,
                      ]
                    : [];
                })}
              </ul>
            )}
          </section>
          {bottleneck && (
            <p className="panel mb-6 text-sm">
              SM-065 is linked to inactive owner <strong>{bottleneck.owner_name}</strong> and{" "}
              <strong>{bottleneck.specs_blocked} modelled spec blockers</strong>. This models
              governance risk; it does not mean those reports have been changed.
            </p>
          )}
          <OwnershipBottlenecks
            rows={bottleneck ? [bottleneck] : data.radar.ownership_bottlenecks?.slice(0, 1)}
          />
          <Link className="request-link mt-3" to="/radar">
            View all ownership bottlenecks
          </Link>
          {modelRequest ? (
            <OwnershipWhatIf row={modelRequest} />
          ) : (
            <p className="panel mt-6">
              No undecided SM-065 request is present in this scope.{" "}
              <Link className="underline" to="/requests" search={{ target: "SM-065" }}>
                Find related requests before simulating an assignment.
              </Link>
            </p>
          )}
        </>
      )}
    </>
  );
}
function OwnershipWhatIf({ row }: { row: WorkItemRow }) {
  const owners = useResource(getOwners);
  const [owner, setOwner] = useState("");
  const [reviewBy, setReviewBy] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [simulation, setSimulation] = useState<RemediationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validDate =
    !!reviewBy &&
    !Number.isNaN(Date.parse(reviewBy)) &&
    reviewBy >= new Date().toISOString().slice(0, 10);
  return (
    <section className="panel mt-6">
      <h2 className="section-title">Assign an active owner: what-if</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Uses the current interpretation of{" "}
        <Link
          to="/requests/$requestId"
          params={{ requestId: row.request_id }}
          className="underline"
        >
          {row.text}
        </Link>
        . Clarification and approval status stay unchanged. This does not change a BI tool or the
        estate.
      </p>
      <ListState
        loading={owners.loading}
        error={owners.error}
        empty={!owners.data?.length}
        retry={owners.reload}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="what-if-owner" className="text-sm">
          Active owner
          <select
            aria-label="Active owner"
            id="what-if-owner"
            className="control mt-2 w-full min-w-0"
            value={owner}
            disabled={busy}
            onChange={(event) => {
              setOwner(event.target.value);
              setSimulation(null);
            }}
          >
            <option value="">Select an active owner</option>
            {owners.data?.map((candidate) => (
              <option key={candidate.owner_id} value={candidate.owner_id}>
                {candidate.owner_name} · {candidate.role} · {candidate.scope}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="what-if-review" className="text-sm">
          Review date
          <input
            aria-label="Review date"
            id="what-if-review"
            type="date"
            className="control mt-2 w-full"
            value={reviewBy}
            disabled={busy}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => {
              setReviewBy(event.target.value);
              setSimulation(null);
            }}
          />
        </label>
      </div>
      <p className="my-4 text-sm">All listed owners are active. Role and scope fit are advisory.</p>
      <button
        className="control"
        disabled={busy || !owner || !validDate || isDemo()}
        onClick={() => {
          setBusy(true);
          setError("");
          void remediate({
            request_id: row.request_id,
            remediations: [{ type: "assign_owner", target: "SM-065", owner_id: owner }],
            review_by: reviewBy,
          })
            .then(setSimulation)
            .catch((failure: unknown) =>
              setError(failure instanceof Error ? failure.message : "Simulation failed."),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Rechecking..." : "Recheck gates (simulation)"}
      </button>
      {isDemo() && <p className="mt-3 text-sm">This what-if needs the live API.</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm">
          {error}{" "}
          <Link to="/admin" className="underline">
            Admin settings
          </Link>
        </p>
      )}
      {simulation && (
        <div className="mt-6">
          <GateComparison simulation={simulation} />
        </div>
      )}
    </section>
  );
}
