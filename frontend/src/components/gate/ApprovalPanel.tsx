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
} from "@/lib/api";
import type { Decided } from "@/lib/use-request";
import { ErrorState, Panel } from "./shared";

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
}: {
  result: RecommendResult;
  blocked: boolean;
  onSpec?: (spec: DashboardSpec, gates?: GateResult) => void;
  decided?: Decided | null | undefined;
  onDecided?: ((d: Decided) => void) | undefined;
}) {
  const [approver, setApprover] = useState("");
  const [owner, setOwner] = useState(proposedOwner(result));
  const [reviewBy, setReviewBy] = useState(inAYear);
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [localDone, setLocalDone] = useState<Decided | null>(null);
  const done = decided ?? localDone;
  const ready = approver.trim() && owner.trim();

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      const res = await approve({
        request_id: result.request_id,
        decision,
        approver,
        owner,
        review_by: reviewBy,
        answers: result.answers ?? [],
        text: result.text,
        action: result.recommendation.action,
        target: result.recommendation.target?.id ?? result.recommendation.build_on ?? "-",
      });
      const record: Decided = { id: res.registered_id, decision, owner, reviewBy };
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
    } catch {
      setError("The decision could not be registered. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className={`${done.decision === "approve" ? "tone-green" : "tone-gray"} rounded-lg border-2 p-5`}
      >
        <p className="text-lg font-semibold">
          {done.decision === "approve" ? "Approved." : "Rejected."} Registered as{" "}
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
    );
  }

  return (
    <Panel title="Approval">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="approver">Approver name</Label>
          <Input
            id="approver"
            className="mt-1"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="owner">Report owner</Label>
          <Input
            id="owner"
            className="mt-1"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="review">Review by</Label>
          <Input
            id="review"
            type="date"
            className="mt-1"
            value={reviewBy}
            onChange={(e) => setReviewBy(e.target.value)}
          />
        </div>
      </div>
      {blocked && (
        <p className="mt-3 text-sm text-muted-foreground">
          Answer the questions above and check again before approving. You can still reject.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorState>{error}</ErrorState>
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="outline" disabled={!ready || !!busy} onClick={() => decide("reject")}>
          {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />} Reject
        </Button>
        <Button disabled={!ready || blocked || !!busy} onClick={() => decide("approve")}>
          {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
        </Button>
      </div>
    </Panel>
  );
}
