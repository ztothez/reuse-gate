import { Button } from "@/components/ui/button";
import type { RecommendResult } from "@/lib/api";
import { evidenceSummary } from "@/lib/summaries";
import { openQuestions, type RequestState } from "@/lib/use-request";
import { ACTIONS, Chip, EmptyState, ErrorState, Panel } from "./shared";
import { ApprovalPanel } from "./ApprovalPanel";
import { Checking, RequestForm } from "./RequestForm";

function Decision({ result }: { result: RecommendResult }) {
  const rec = result.recommendation;
  const meta = ACTIONS[rec.action] ?? ACTIONS.human_review;
  const Icon = meta.icon;
  return (
    <div className={`${meta.tone} flex items-start gap-4 rounded-lg border-2 p-6`} role="status">
      <Icon className="h-10 w-10 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
          Decision to approve
        </p>
        <p className="text-2xl font-semibold">{meta.label}</p>
        {(rec.target || rec.build_on) && (
          <p className="mt-1 text-lg font-medium">
            {rec.target ? rec.target.name : `Build on semantic model ${rec.build_on}`}
            {rec.target && (
              <span className="ml-2 align-middle">
                <Chip mono>{rec.target.id}</Chip>
              </span>
            )}
          </p>
        )}
        {rec.rationale[0] && <p className="mt-2 text-sm opacity-90">{rec.rationale[0]}</p>}
      </div>
    </div>
  );
}

export function ApproverView({ state }: { state: RequestState }) {
  const { loading, error, result } = state;
  const questions = result ? openQuestions(result) : [];
  const summary = result ? evidenceSummary(result.recommendation.evidence) : null;

  return (
    <div className="space-y-6">
      {!result && <RequestForm state={state} />}
      {loading && <Checking />}
      {error && <ErrorState>{error}</ErrorState>}
      {!result && !loading && (
        <EmptyState>No request to decide yet. Submit one here or as the Requester.</EmptyState>
      )}
      {result && summary && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-medium text-muted-foreground">Request:</span> {result.text}
            </p>
            <Button variant="outline" size="sm" onClick={state.reset}>
              New request
            </Button>
          </div>
          <Decision result={result} />
          {state.accepted && result.recommendation.target && (
            <p role="note" className="tone-blue rounded-md border px-4 py-3 text-sm font-medium">
              The requester chose to use {result.recommendation.target.name}.
            </p>
          )}
          {questions.length > 0 && (
            <p role="note" className="tone-amber rounded-md border px-4 py-3 text-sm">
              Open questions
              {result.loop
                ? ` (round ${result.loop.rounds_used + 1} of ${result.loop.max_rounds})`
                : ""}
              : {questions.map((q) => q.phrased ?? q.text).join("; ")}. Approval waits for the
              requester&apos;s answers; you can still reject.
            </p>
          )}
          {result.loop?.status === "human_review" && (
            <p role="note" className="tone-red rounded-md border px-4 py-3 text-sm font-medium">
              Still unclear after {result.loop.max_rounds} rounds of questions, so nothing was
              decided automatically. You decide this request.
            </p>
          )}
          <Panel
            title="Evidence summary"
            caption="Full evidence, citations, spec and gates are in the Steward view."
          >
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{summary.rows}</span> cited rows from{" "}
              <span className="font-semibold tabular-nums">{summary.tables}</span> data pack tables,
              including <span className="font-semibold tabular-nums">{summary.rules}</span>{" "}
              governance rules.
            </p>
            {summary.top.length > 0 && (
              <ol className="mt-3 space-y-2 text-sm">
                {summary.top.map((e) => (
                  <li key={e.table + e.id} className="flex flex-wrap items-center gap-2">
                    <Chip mono>
                      {e.table} / {e.id}
                    </Chip>
                    <span>{e.note}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <ApprovalPanel
            key={result.request_id + result.text}
            result={result}
            blocked={questions.length > 0}
            decided={state.decided}
            onDecided={state.setDecided}
          />
          {state.decided?.gates && (
            <p
              role="note"
              className={`${state.decided.gates.passed ? "tone-green" : "tone-red"} rounded-md border px-4 py-3 text-sm font-medium`}
            >
              {state.decided.gates.passed
                ? "Dashboard spec generated. All quality gates passed."
                : "Dashboard spec generated, but release is blocked by a quality gate. See the Steward view."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
