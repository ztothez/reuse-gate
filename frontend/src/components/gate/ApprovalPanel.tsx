import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  approve,
  generateSpec,
  type DashboardSpec,
  type GateResult,
  type RecommendResult,
  type Owner,
  type LoopRound,
  ApiError,
  type RemediationResult,
} from "@/lib/api";
import { confirmedIntent, requestGates } from "@/lib/governance";
import type { Decided } from "@/lib/use-request";
import { ErrorState, Panel } from "./shared";
import { ApprovalReadiness } from "./ApprovalReadiness";

const proposedOwner = (result: RecommendResult) => {
  const fromSpec = result.pipeline?.find((s) => s.stage === "Spec")?.output["owner"];
  return (typeof fromSpec === "string" && fromSpec) || result.recommendation.target?.owner || "";
};
const inAYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

export function ApprovalPanel({
  result,
  blocked,
  onSpec,
  decided,
  onDecided,
  readiness = false,
  workItemId,
  workItemRounds,
  initialRemediation,
  unavailableReason,
}: {
  result: RecommendResult;
  blocked: boolean;
  onSpec?: (spec: DashboardSpec, gates?: GateResult) => void;
  decided?: Decided | null | undefined;
  onDecided?: ((d: Decided) => void) | undefined;
  readiness?: boolean;
  workItemId?: string | undefined;
  workItemRounds?: LoopRound[] | undefined;
  initialRemediation?: RemediationResult | null | undefined;
  unavailableReason?: string | undefined;
}) {
  const [approver, setApprover] = useState("");
  const [owner, setOwner] = useState(initialRemediation?.remediations[0]?.owner_id ?? proposedOwner(result));
  const [reviewBy, setReviewBy] = useState(inAYear);
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [localDone, setLocalDone] = useState<Decided | null>(null);
  const [selection, setSelection] = useState<Owner | null>(null);
  const [checked, setChecked] = useState<RemediationResult | null>(null);
  const [checkedInputs, setCheckedInputs] = useState("");
  const [checking, setChecking] = useState(false);
  const done = decided ?? localDone;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(reviewBy) &&
    !Number.isNaN(Date.parse(reviewBy)) && new Date(reviewBy).toISOString().slice(0, 10) === reviewBy &&
    reviewBy >= new Date().toISOString().slice(0, 10);
  const ready = approver.trim() && owner.trim() && validDate;
  const simulationCurrent = !!checked && checkedInputs === `${owner}|${reviewBy}`;
  const needsOwnerResolution = readiness && requestGates(result)?.gates.some((gate) => gate.gate === "owner_and_review_date" && !gate.passed);
  const resolutionPending = needsOwnerResolution && (!selection || !simulationCurrent);
  const locked = !!busy || checking;
  const reason = unavailableReason || (blocked ? "Answer open questions or recheck an outdated request before approving." : !approver.trim() ? "Enter the approver name." : !owner.trim() ? "Choose a report owner." : !validDate ? "Enter a valid review date, today or later." : resolutionPending ? "Choose an active owner and recheck the simulation before approving." : "");
  const readinessView = readiness ? (
    <ApprovalReadiness
      result={result}
      workItemId={workItemId}
      owner={done?.owner ?? owner}
      selection={selection}
      onSelect={(next) => { setSelection(next); setOwner(next?.owner_id ?? ""); }}
      reviewBy={done?.reviewBy ?? reviewBy}
      simulation={checked ?? done?.remediation ?? initialRemediation ?? null}
      simulationCurrent={!!done?.remediation || simulationCurrent}
      onChecked={(simulation) => { setChecked(simulation); setCheckedInputs(`${owner}|${reviewBy}`); }}
      onChecking={setChecking}
      disabled={locked || !!unavailableReason}
      recheckBlocked={blocked || !validDate}
      done={!!done}
    />
  ) : null;

  async function decide(decision: "approve" | "reject") {
    if (unavailableReason || !ready || locked || (decision === "approve" && (blocked || resolutionPending))) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await approve({
        request_id: workItemId ?? result.request_id,
        decision,
        approver,
        owner,
        review_by: reviewBy,
        answers: result.answers ?? [],
        intent: confirmedIntent(result),
        rounds: workItemRounds ?? result.loop?.rounds ?? [],
        remediations: checked && simulationCurrent ? checked.remediations.map(({ type, target, owner_id }) => ({ type, target, owner_id })) : [],
        text: result.text,
        action: result.recommendation.action,
        ...(result.recommendation.target ? { target: result.recommendation.target.id } : {}),
      });
      if (res.ok !== true) throw new Error("Approval was not confirmed");
      const record: Decided = { id: res.registered_id, decision, owner, reviewBy, mode: res.mode, remediation: simulationCurrent ? checked ?? undefined : undefined };
      if (
        decision === "approve" &&
        (result.recommendation.action === "new_build" || result.recommendation.action === "extend")
      ) {
        try {
          const generated = await generateSpec(result, owner, reviewBy);
          record.spec = generated.spec;
          record.gates = generated.gates;
          onSpec?.(generated.spec, generated.gates);
        } catch {
          setError("Decision registered, but the dashboard spec preview could not be generated.");
        }
      }
      setLocalDone(record);
      onDecided?.(record);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The decision could not be registered. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="space-y-6">
      {readinessView}
      <div
        role="status"
        className={`${done.decision === "approve" ? "tone-green" : "tone-gray"} rounded-lg border-2 p-5`}
      >
        <p className="text-lg font-semibold">
          {done.decision === "approve" ? "Approved." : "Rejected."} {done.mode === "demo" ? "Demo decision." : ""} Registered as{" "}
          <span className="font-mono">{done.id}</span>
        </p>
        <p className="mt-1 text-sm">
          Owner: {done.owner} · Review by {done.reviewBy} · Added to the Decision log
        </p>
        {error && (
          <div className="mt-3">
            <ErrorState>{error}</ErrorState>
          </div>
        )}
      </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
    {readinessView}
    <Panel title="Approval">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="approver">Approver name</Label>
          <Input
            disabled={locked}
            id="approver"
            className="mt-1"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="owner">Report owner</Label>
          <Input
            disabled={locked}
            readOnly={!!needsOwnerResolution}
            id="owner"
            className="mt-1"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="review">Review by</Label>
          <Input
            disabled={locked}
            required
            min={new Date().toISOString().slice(0, 10)}
            aria-invalid={!validDate}
            aria-describedby="review-help"
            id="review"
            type="date"
            className="mt-1"
            value={reviewBy}
            onChange={(e) => setReviewBy(e.target.value)}
          />
        </div>
      </div>
      <p id="review-help" className="mt-3 text-sm">Review date is required and must be today or later.</p>
      {resolutionPending && <p className="mt-3 text-sm">Choose an active owner above and recheck the simulation before approving.</p>}
      {blocked && (
        <p className="mt-3 text-sm text-muted-foreground">
          Answer the questions above and check again before approving. You can still reject.
        </p>
      )}
      {reason && <p id="approval-disabled-reason" className="mt-3 text-sm">{reason}</p>}
      {error && (
        <div className="mt-3">
          <ErrorState>{error}</ErrorState>
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="outline" disabled={!ready || locked || !!unavailableReason} onClick={() => decide("reject")}>
          {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />} Reject
        </Button>
        <Button aria-describedby={reason ? "approval-disabled-reason" : undefined} disabled={!ready || blocked || locked || !!resolutionPending || !!unavailableReason} onClick={() => decide("approve")}>
          {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
        </Button>
      </div>
    </Panel>
    </div>
  );
}
