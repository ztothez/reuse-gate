import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { exampleRequests } from "@/lib/api";
import type { RequestState } from "@/lib/use-request";

// The standard request box with example chips, used by the Approver and Steward views.
export function RequestForm({ state }: { state: RequestState }) {
  const { text, setText, loading, submit } = state;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-lg border bg-card p-5 shadow-panel"
    >
      <Label htmlFor="req" className="text-base font-semibold">
        Describe the dashboard or report you need
      </Label>
      <Textarea
        id="req"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="mt-3 text-base"
        placeholder="e.g. A monthly view of Xarelto net sales by country…"
      />
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={loading || !text.trim()}>
          {loading ? <Loader2 className="animate-spin" /> : <Send />} Submit
        </Button>
      </div>
      <div className="mt-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Examples
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {exampleRequests.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="max-w-full truncate rounded-full border bg-secondary px-3 py-1 text-left text-xs text-secondary-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

export function Checking() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border bg-card p-6 text-muted-foreground"
    >
      <Loader2 className="h-5 w-5 animate-spin" /> Checking existing reports, KPIs and governance
      rules…
    </div>
  );
}
