import type { GateSnapshot, RemediationResult } from "@/lib/api";
import { displayText } from "@/lib/display-text";

export const SIMULATION_NOTICE = "Simulated. Nothing in the BI tool or the estate has changed.";

export function GateList({ gates }: { gates: GateSnapshot }) {
  if (gates.passed === null)
    return (
      <div className="text-sm">
        <p>No spec gates apply to this decision.</p>
        {gates.reason && <p className="mt-2 text-muted-foreground">{displayText(gates.reason)}</p>}
      </div>
    );
  return (
    <div className="min-w-0 space-y-3">
      {(gates.owner !== undefined || gates.as_of) && (
        <p className="break-words text-xs text-muted-foreground">
          {gates.owner !== undefined ? `Owner at check: ${gates.owner ?? "Not assigned"}. ` : ""}
          {gates.as_of ? `As of ${new Date(gates.as_of).toLocaleDateString()}.` : ""}
        </p>
      )}
      <p className="text-sm font-semibold">
        {gates.passing ?? gates.gates.filter((gate) => gate.passed).length} of{" "}
        {gates.total ?? gates.gates.length} gates passing
      </p>
      <ul className="space-y-2 text-sm">
        {gates.gates.map((gate) => (
          <li key={gate.gate} className="rounded-md bg-muted p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="break-all text-xs">{gate.gate}</code>
              <strong className={gate.passed ? "text-foreground" : "text-destructive"}>
                {gate.passed ? "Passed" : "Blocked"}
              </strong>
            </div>
            <p className="mt-1 break-words">{displayText(gate.detail)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GateComparison({ simulation }: { simulation: RemediationResult }) {
  return (
    <section aria-label="Simulation record" className="min-w-0 space-y-5">
      <p className="tone-blue rounded-md border p-4 text-sm font-semibold">
        <span className="mb-1 block">Simulated, not applied</span>
        {SIMULATION_NOTICE}
      </p>
      <ul className="space-y-2 text-sm">
        {simulation.remediations.map((assignment) => (
          <li key={assignment.target} className="break-words">
            Proposed owner for <strong>{assignment.target}</strong>: {assignment.owner_name} (
            {assignment.owner_id}). Estate owner at check:{" "}
            {assignment.from_owner_id ?? "unassigned"}
            {assignment.from_status ? ` (${assignment.from_status})` : ""}.
          </li>
        ))}
      </ul>
      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        <section aria-label="Before simulation" className="min-w-0 space-y-3">
          <h4 className="font-semibold">Before simulation</h4>
          <GateList gates={simulation.before.gates} />
        </section>
        <section aria-label="After simulation" className="min-w-0 space-y-3">
          <h4 className="font-semibold">After simulation</h4>
          <GateList gates={simulation.after.gates} />
        </section>
      </div>
      <section aria-label="Gate changes" className="space-y-2 text-sm">
        <h4 className="font-semibold">Gate changes</h4>
        {simulation.diff.length === 0 ? (
          <p>No gate changes in this simulation.</p>
        ) : (
          <ul className="space-y-3">
            {simulation.diff.map((change) => (
              <li key={change.gate} className="break-words">
                <p>
                  <code className="break-all">{change.gate}</code>:{" "}
                  {change.before ? "Passed" : "Blocked"} to {change.after ? "Passed" : "Blocked"}
                </p>
                <p className="text-muted-foreground">
                  Before: {displayText(change.detail_before)}. After:{" "}
                  {displayText(change.detail_after)}.
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="break-words font-semibold">
          {simulation.still_failing.length
            ? `Still blocked in this simulation: ${simulation.still_failing.join(", ")}`
            : simulation.after.gates.passed === true
              ? "All gates pass in this simulation."
              : "No spec gate verdict is available."}
        </p>
      </section>
      <p className="break-all text-xs text-muted-foreground">
        Estate snapshot: {simulation.estate_snapshot.slice(0, 19)} · As of {simulation.as_of}
      </p>
    </section>
  );
}
