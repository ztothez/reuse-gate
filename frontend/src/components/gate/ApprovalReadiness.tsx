import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { canRemediate, getOwners, onDemoChange, remediate, type Owner, type RecommendResult, type RemediationResult } from "@/lib/api";
import { openQuestions } from "@/lib/use-request";
import { ownerSimulation, requestGates } from "@/lib/governance";
import { ErrorState, Panel } from "./shared";
import { GateComparison, GateList } from "./GateComparison";

export function ApprovalReadiness({ result, owner, selection, onSelect, reviewBy, simulation, simulationCurrent, onChecked, onChecking, workItemId, disabled = false, recheckBlocked = false, done = false }: {
  result: RecommendResult;
  workItemId?: string | undefined;
  owner: string;
  selection: Owner | null;
  onSelect: (owner: Owner | null) => void;
  reviewBy: string;
  simulation: RemediationResult | null;
  simulationCurrent: boolean;
  onChecked: (simulation: RemediationResult) => void;
  onChecking: (checking: boolean) => void;
  disabled?: boolean;
  recheckBlocked?: boolean;
  done?: boolean;
}) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [live, setLive] = useState(canRemediate);
  useEffect(() => onDemoChange(() => setLive(canRemediate())), []);
  useEffect(() => {
    let active = true;
    getOwners().then((rows) => { if (active) setOwners(rows); }).catch(() => {
      if (active) setOwnerError("Could not load active owners. Return to this view to try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const original = requestGates(result);
  const gates = simulation && simulationCurrent ? simulation.after.gates : original;
  const failed = gates?.gates.filter((gate) => !gate.passed) ?? [];
  const ownershipBlocked = original?.gates.some((gate) => gate.gate === "owner_and_review_date" && !gate.passed);
  const activeOwner = owners.find((candidate) => candidate.owner_id === owner || candidate.owner_name === owner);
  const target = result.recommendation.build_on ?? result.recommendation.target?.id;
  const suggested = owners.filter((candidate) => candidate.role === "Semantic Model Owner");
  const others = owners.filter((candidate) => candidate.role !== "Semantic Model Owner");
  const matchesMarket = (candidate: Owner) => candidate.scope.toLowerCase() === result.intent.market.toLowerCase();
  const sortMarket = (a: Owner, b: Owner) => Number(matchesMarket(b)) - Number(matchesMarket(a));

  async function recheck() {
    if (!selection || checking || disabled || recheckBlocked || done || !live) return;
    setChecking(true);
    onChecking(true);
    setError(null);
    try {
      const response = await remediate(ownerSimulation(result, selection.owner_id, reviewBy, workItemId));
      onChecked(response);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not recheck gates. Try again.");
    } finally {
      setChecking(false);
      onChecking(false);
    }
  }

  return (
    <Panel title="Approval readiness">
      <ol aria-label="Approval readiness steps" className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <li className="min-w-0 rounded-md bg-muted p-3">
          <p className="font-semibold">Request confirmed</p>
          <p className="mt-1">{openQuestions(result).length ? "Waiting for answers" : "No open questions"}</p>
        </li>
        <li className="min-w-0 rounded-md bg-muted p-3">
          <p className="font-semibold">Evidence checked</p>
          <p className="mt-1">{result.recommendation.evidence.length} cited rows</p>
        </li>
        <li className="min-w-0 rounded-md bg-muted p-3">
          <p className="font-semibold">Gates</p>
          <p className="mt-1">{gates?.passed === true ? simulation && simulationCurrent ? "Passed in simulation" : "Passed" : gates?.passed === false ? "Blocked" : gates?.passed === null ? "No spec gates" : "Not available"}</p>
          {gates && gates.passed !== null && gates.gates.length > 0 && <p className="mt-1 text-xs">{gates.gates.filter((gate) => gate.passed).length} of {gates.gates.length} gates passing</p>}
          {failed.length > 0 && <p className="mt-1 break-all text-xs">{failed.map((gate) => gate.gate).join(", ")}</p>}
        </li>
        <li className="min-w-0 rounded-md bg-muted p-3">
          <p className="font-semibold">Owner</p>
          <p className="mt-1 break-words">{activeOwner ? `${activeOwner.owner_name} (${activeOwner.owner_id}), active` : loading ? "Checking active owners..." : "Active owner required"}</p>
        </li>
      </ol>
      {!live && <p role="note" className="mt-4 text-sm">The gate simulation needs the live API. Demo and mock data cannot simulate an assignment.</p>}
      {ownershipBlocked && (
        <div className="mt-5 space-y-4">
          <p className="tone-amber rounded-md border p-4 text-sm"><strong>Original blocker:</strong> The owner and review date gate is blocked. An active owner and a valid review date are required. Recheck the gates to see a simulated resolution.</p>
          {ownerError && <ErrorState>{ownerError}</ErrorState>}
          <div>
            <label htmlFor="resolution-owner" className="block text-sm font-semibold">Choose an active owner for {target ?? "this decision"}</label>
            <select id="resolution-owner" value={selection?.owner_id ?? (done ? activeOwner?.owner_id : "") ?? ""} disabled={loading || checking || disabled || done} onChange={(event) => onSelect(owners.find((candidate) => candidate.owner_id === event.target.value) ?? null)} aria-describedby="owner-selection-help" className="mt-2 min-h-11 w-full min-w-0 max-w-full rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">Select an active owner</option>
              {[{ label: "Semantic Model Owners (suggested)", rows: suggested }, { label: "Other active owners", rows: others }].map((group) => group.rows.length > 0 && (
                <optgroup key={group.label} label={group.label}>
                  {group.rows.sort(sortMarket).map((candidate) => <option key={candidate.owner_id} value={candidate.owner_id} className={matchesMarket(candidate) ? "bg-secondary font-semibold" : ""}>{candidate.owner_name} ({candidate.owner_id}) · {candidate.role} · {candidate.scope}{matchesMarket(candidate) ? " · matches market" : ""}</option>)}
                </optgroup>
              ))}
            </select>
            <p id="owner-selection-help" className="mt-2 text-sm text-muted-foreground">Semantic Model Owners are suggested first. Market matches are highlighted. Every listed owner is active and selectable; the gate checks active status, not role or scope fit.</p>
            {selection && <p className={`mt-2 rounded-md p-3 text-sm ${matchesMarket(selection) ? "tone-blue" : "bg-muted"}`}>{selection.owner_name}: {matchesMarket(selection) ? `Scope matches the request market (${selection.scope}).` : `Scope: ${selection.scope}. The active-owner gate does not enforce scope fit.`}</p>}
          </div>
          {!done && <Button className="min-h-11 max-w-full whitespace-normal" disabled={disabled || recheckBlocked || checking || !selection || !live || !target} onClick={() => void recheck()}>{checking ? "Rechecking gates..." : "Recheck gates (simulation)"}</Button>}
          {error && <ErrorState>{error}</ErrorState>}
        </div>
      )}
      {original && <details className="mt-5 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Original gate checks</summary><GateList gates={original} /></details>}
      {simulation && <div className="mt-5 space-y-4">
        {!simulationCurrent && <p role="alert" className="tone-amber rounded-md border p-3 text-sm">Inputs changed. This simulation is outdated. Recheck gates before approving.</p>}
        <GateComparison simulation={simulation} />
      </div>}
    </Panel>
  );
}
