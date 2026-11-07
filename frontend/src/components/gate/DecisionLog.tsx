import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newBuildsAvoided, useDecisionLog } from "@/lib/decision-log";
import { ACTIONS, EmptyState, ErrorState, Panel } from "./shared";

export function DecisionLog() {
  const { log, loading, error, refresh } = useDecisionLog();

  function exportLog() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "reuse-gate-decisions.json";
    a.click();
    URL.revokeObjectURL(url);
  }

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
          <Button variant="outline" onClick={exportLog} disabled={log.length === 0}>
            <Download /> Export JSON
          </Button>
        </div>
      </div>
      {error && <ErrorState>{error}</ErrorState>}
      <Panel title="Decisions" caption="Read from the API decision log (GET /log), newest first.">
        {log.length === 0 ? (
          <EmptyState>
            {loading
              ? "Loading decisions..."
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
                  ].map((h) => (
                    <th key={h} className="py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {new Date(e.time).toLocaleString()}
                    </td>
                    <td className="max-w-xs pr-3">{e.text}</td>
                    <td className="pr-3">
                      {e.action ? (ACTIONS[e.action]?.label ?? e.action) : "-"}
                    </td>
                    <td className="pr-3 font-mono text-xs">{e.target}</td>
                    <td className="pr-3 font-medium">
                      {e.decision === "approve" ? "Approved" : "Rejected"}{e.mode === "demo" ? " (demo)" : ""}
                    </td>
                    <td className="pr-3">{e.approver}</td>
                    <td className="pr-3">{e.owner}</td>
                    <td className="whitespace-nowrap">{e.review_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
