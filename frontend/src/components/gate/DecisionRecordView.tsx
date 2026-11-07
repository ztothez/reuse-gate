import type { DecisionRecord, GateSnapshot } from "@/lib/api";
import { GateList, SIMULATION_NOTICE } from "./GateComparison";

export function DecisionRecordView({ record, origin }: { record: DecisionRecord; origin: "live" | "demo" }) {
  const before = record.gates?.before_remediation;
  const legacyFinal: GateSnapshot | null = record.gates?.gates && record.gates.passed !== undefined
    ? { passed: record.gates.passed, gates: record.gates.gates }
    : null;
  const final = record.gates?.at_approval ?? legacyFinal ?? record.remediation?.after.gates ?? null;
  const blockers = before?.gates.filter((gate) => !gate.passed) ?? [];
  return <section aria-label="Decision record" className="max-w-3xl space-y-5 rounded-lg bg-muted/50 p-4">
    <h4 className="font-semibold">Registered decision record</h4>
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2"><dt className="font-semibold">Request text</dt><dd className="mt-1 break-words">{record.request_text}</dd></div>
      <div><dt className="font-semibold">Clarification rounds</dt><dd>{record.rounds.length}</dd></div>
      <div><dt className="font-semibold">Origin</dt><dd>{origin}</dd></div>
      <div><dt className="font-semibold">Approver</dt><dd className="break-words">{record.approver}</dd></div>
      <div><dt className="font-semibold">Decision</dt><dd>{record.decision} · {record.recommendation.action.replace(/_/g, " ")}</dd></div>
      <div><dt className="font-semibold">Build on model</dt><dd>{record.recommendation.build_on ?? "None"}</dd></div>
      <div><dt className="font-semibold">Owner</dt><dd className="break-words">{record.owner}</dd></div>
      <div><dt className="font-semibold">Review by</dt><dd>{record.review_by}</dd></div>
      <div className="min-w-0 sm:col-span-2"><dt className="font-semibold">Estate snapshot</dt><dd className="break-all font-mono text-xs" title={record.estate_snapshot}>{record.estate_snapshot.slice(0, 19)}</dd></div>
    </dl>
    {record.remediation && <div className="space-y-3 text-sm">
      <p className="tone-blue rounded-md border p-4 font-semibold">{SIMULATION_NOTICE}</p>
      <ul className="space-y-2">
        {record.remediation.remediations.map((assignment) => <li key={assignment.target} className="break-words">
          Proposed owner for <strong>{assignment.target}</strong>: {assignment.owner_name} ({assignment.owner_id}). Estate owner at check: {assignment.from_owner_id ?? "unassigned"}{assignment.from_status ? ` (${assignment.from_status})` : ""}.
        </li>)}
      </ul>
    </div>}
    {before && <p className="break-words text-sm font-semibold">{blockers.length ? `Original blockers: ${blockers.map((gate) => gate.gate).join(", ")}.` : "No blocking gates were recorded before remediation."}</p>}
    <div className={`grid min-w-0 gap-5 ${before ? "md:grid-cols-2" : ""}`}>
      {before && <section aria-label="Before remediation" className="min-w-0 space-y-3">
        <h4 className="font-semibold">Before remediation</h4>
        <GateList gates={before} />
      </section>}
      <section aria-label="At approval" className="min-w-0 space-y-3">
        <h4 className="font-semibold">{before ? "At approval" : "Final result at approval"}</h4>
        {final ? <GateList gates={final} /> : <p className="text-sm">No spec gates were recorded.</p>}
      </section>
    </div>
    {record.note && <p className="break-words text-sm">{record.note}</p>}
  </section>;
}
