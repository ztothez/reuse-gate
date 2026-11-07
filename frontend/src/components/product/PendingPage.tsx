import { useEffect, useState } from "react";

// Shown while a page loads, and in the prerendered HTML before scripts run, so the first paint already says what this is.
export function PendingPage() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <p className="text-lg font-semibold">Reuse Gate</p>
      <p className="max-w-3xl text-muted-foreground">
        Before anyone builds a new dashboard, Reuse Gate checks whether an existing report can be
        reused, repaired, extended or retired, and a person approves the decision.
      </p>
      <div aria-hidden className="space-y-3">
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      </div>
      <p className="text-sm">
        {slow
          ? "Still loading. Check your connection, then reload the page."
          : "Loading the workspace..."}
      </p>
      {slow && (
        <button className="control" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </div>
  );
}
