import type { DecisionRecord } from "@/lib/api";
import { GateComparison, GateList } from "./GateComparison";

export function DecisionRecordView({ record, origin }: { record: DecisionRecord; origin: "live" | "demo" }) {
  return <section aria-label="Decision record" className="max-w-3xl space-y-5 rounded-lg bg-muted/50 p-4">
    <h4 className="font-semibold">Registered decision record</h4>
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2"><dt className="font-semibold">Request text</dt><dd className="mt-1 break-words">{record.request_text}</dd></div>
      <div><dt className="font-semibold">Clarification rounds</dt><dd>{record.rounds.length}</dd></div>
      <div><dt className="font-semibold">Origin</dt><dd>{origin}</dd></div>
      <div><dt className="font-semibold">Decision</dt><dd>{record.decision} · {record.recommendation.action.replace(/_/g, " ")}</dd></div>
      <div><dt className="font-semibold">Build on model</dt><dd>{record.recommendation.build_on ?? "None"}</dd></div>
      <div><dt className="font-semibold">Owner</dt><dd className="break-words">{record.owner}</dd></div>
      <div><dt className="font-semibold">Review by</dt><dd>{record.review_by}</dd></div>
      <div className="min-w-0 sm:col-span-2"><dt className="font-semibold">Estate snapshot</dt><dd className="break-all font-mono text-xs" title={record.estate_snapshot}>{record.estate_snapshot.slice(0, 19)}</dd></div>
    </dl>
    {record.remediation ? <GateComparison simulation={record.remediation} /> : <div className="space-y-3">
      <h4 className="font-semibold">Recorded gates</h4>
      {record.gates ? <GateList gates={record.gates} /> : <p className="text-sm">No spec gates were recorded.</p>}
      <p className="text-sm">No before and after simulation was recorded.</p>
    </div>}
    {record.note && <p className="break-words text-sm">{record.note}</p>}
  </section>;
}
