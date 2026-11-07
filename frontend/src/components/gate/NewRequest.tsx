import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRequestState, type RequestState } from "@/lib/use-request";
import { ErrorState } from "./shared";
import { ResultView } from "./ResultView";
import { Checking, RequestForm } from "./RequestForm";

function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// The full Steward experience. Without a shared state it keeps its own, so it also works alone.
export function NewRequest({ state: shared }: { state?: RequestState }) {
  const own = useRequestState();
  const state = shared ?? own;
  const { loading, error, result, rechecking, recheck } = state;

  return (
    <div className="space-y-6">
      <RequestForm state={state} />
      {loading && <Checking />}
      {error && <ErrorState>{error}</ErrorState>}
      {state.outdated && <ErrorState>Outdated result. Resubmit the edited request before approving.</ErrorState>}
      {result && (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => downloadJson(result, `reuse-gate-${result.request_id}.json`)}
            >
              <Download /> Download raw JSON
            </Button>
          </div>
          <ResultView
            key={result.request_id + result.text}
            result={result}
            onAnswers={recheck}
            rechecking={rechecking}
            outdated={state.outdated}
            decided={state.decided}
            onDecided={state.setDecided}
          />
        </>
      )}
    </div>
  );
}
