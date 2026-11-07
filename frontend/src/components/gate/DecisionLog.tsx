import { Download, Loader2, RefreshCw } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { newBuildsAvoided, useDecisionLog } from "@/lib/decision-log";
import { ACTIONS, EmptyState, ErrorState, Panel } from "./shared";
import { isDemo } from "@/lib/api";
import { downloadDecisions } from "@/lib/log-export";
import { DecisionRecordView } from "./DecisionRecordView";

export function DecisionLog() {
  const { log, loading, error, refresh } = useDecisionLog();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("");
  const [owner, setOwner] = useState("");
  const visible = log.filter(
    (entry) =>
      (!query ||
        `${entry.text} ${entry.id} ${entry.approver} ${entry.target}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!decision || entry.decision === decision) &&
      (!owner || entry.owner === owner),
  );
  const exportCsv = () => downloadDecisions(visible, "csv");
  const exportLog = () => downloadDecisions(visible, "json");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-2 gap-4">
          {[
            ["Decisions made", log.length],
            ["New builds avoided", newBuildsAvoided(log)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-lg border bg-card p-4 shadow-panel">
              <p className="text-3xl font-semibold tabular-nums">{v}</p>
              <p className="mt-1 text-sm text-muted-foreground">{k}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
          <Button onClick={exportCsv} disabled={visible.length === 0}>
            <Download /> Export CSV
          </Button>
          <Button variant="outline" onClick={exportLog} disabled={visible.length === 0}>
            <Download /> Export JSON
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          Filter decisions
          <input
            className="control mt-2 w-full"
            disabled={loading}
            aria-label="Filter decisions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Request, approver or report"
          />
        </label>
        <label htmlFor="log-decision-filter" className="text-sm">
          Decision
          <select
            disabled={loading}
            aria-label="Decision"
            id="log-decision-filter"
            className="control mt-2 w-full"
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            <option value="">All decisions</option>
            <option value="approve">Approved</option>
            <option value="reject">Rejected</option>
          </select>
        </label>
        <label className="text-sm">
          Recorded owner
          <select
            className="control mt-2 w-full"
            disabled={loading}
            aria-label="Recorded owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">All owners</option>
            {[...new Set(log.map((entry) => entry.owner))]
              .filter(Boolean)
              .sort()
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {visible.length} of {log.length} decisions shown. Exports contain only visible rows. Counts
        describe registered routes, not changes applied in a BI tool.
      </p>
      {error && <ErrorState>{error}</ErrorState>}
      <Panel title="Decisions" caption="Read from the API decision log (GET /log), newest first.">
        {visible.length === 0 ? (
          <EmptyState>
            {loading
              ? "Loading decisions..."
              : log.length
                ? "No decisions match these filters."
                : isDemo()
                  ? "No server decisions are available offline."
                  : "No decisions yet. Approve or reject a recommendation as an Approver."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "Time",
                    "Request",
                    "Action",
                    "Target",
                    "Decision",
                    "Approver",
                    "Owner",
                    "Review by",
                    "Record",
                  ].map((h) => (
                    <th key={h} className="py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="border-t align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(e.time).toLocaleString()}
                      </td>
                      <td className="max-w-xs pr-3">{e.text}</td>
                      <td className="pr-3">
                        {e.action ? (ACTIONS[e.action]?.label ?? e.action) : "-"}
                      </td>
                      <td className="pr-3 font-mono text-xs">{e.target}</td>
                      <td className="pr-3 font-medium">
                        {e.decision === "approve" ? "Approved" : "Rejected"}
                        {e.mode === "demo" ? " (demo)" : ""}
                      </td>
                      <td className="pr-3">{e.approver}</td>
                      <td className="pr-3">{e.owner}</td>
                      <td className="whitespace-nowrap">{e.review_by}</td>
                      <td className="pl-3">
                        {e.record ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            aria-expanded={expanded.has(e.id)}
                            aria-controls={`record-${e.id}`}
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(e.id)) next.delete(e.id);
                                else next.add(e.id);
                                return next;
                              })
                            }
                          >
                            {expanded.has(e.id) ? "Hide" : "View"} record {e.id}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">No detailed record</span>
                        )}
                      </td>
                    </tr>
                    {e.record && expanded.has(e.id) && (
                      <tr id={`record-${e.id}`}>
                        <td colSpan={9} className="py-4">
                          <div className="record-view-width sticky left-0">
                            <DecisionRecordView
                              record={e.record}
                              origin={e.mode === "demo" ? "demo" : "live"}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
