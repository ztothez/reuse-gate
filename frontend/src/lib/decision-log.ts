import { useCallback, useEffect, useState } from "react";
import { getLog, type Action, type LogRecord } from "./api";

// A decision as the Admin view shows it. Older API rows carry no text, action or target.
export interface LogEntry {
  mode?: "demo";
  id: string;
  time: string;
  text: string;
  action: Action | null;
  target: string;
  decision: "approve" | "reject";
  approver: string;
  owner: string;
  review_by: string;
}

export const toEntry = (r: LogRecord): LogEntry => ({
  ...(r.mode === "demo" ? { mode: "demo" as const } : {}),
  id: r.registered_id,
  time: r.time,
  text: r.text ?? r.request_id,
  action: r.action ?? null,
  target: r.target ?? "-",
  decision: r.decision,
  approver: r.approver,
  owner: r.owner,
  review_by: r.review_by,
});

// Newest first, as read from GET /log (or the in-memory demo log when the API is unavailable).
export function useDecisionLog() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLog((await getLog()).map(toEntry).reverse());
    } catch {
      setError("Could not load the decision log.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { log, loading, error, refresh };
}

// Unknown actions are not counted: only a recorded reuse-style decision avoids a build.
export const newBuildsAvoided = (log: LogEntry[]) =>
  log.filter((e) => e.decision === "approve" && e.action && e.action !== "new_build").length;
