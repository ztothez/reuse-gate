import { AlertTriangle, CheckCircle2, Circle, CircleDot, Cpu, Server } from "lucide-react";
import { getHealth, type RecommendResult, type WorkItem } from "@/lib/api";
import { requestGates } from "@/lib/governance";
import { useResource } from "@/lib/use-resource";
import { ACTIONS } from "@/components/gate/shared";

type StepState = "done" | "current" | "blocked" | "pending";
const STEP_META: Record<StepState, { label: string; icon: typeof Circle; tone: string }> = {
  done: { label: "Done", icon: CheckCircle2, tone: "tone-green" },
  current: { label: "Next", icon: CircleDot, tone: "tone-blue" },
  blocked: { label: "Blocked", icon: AlertTriangle, tone: "tone-amber" },
  pending: { label: "Not yet", icon: Circle, tone: "tone-gray" },
};

// The five stages a request moves through, read from the saved item. Nothing here decides: it reports what the API returned.
export function decisionSteps(
  item: WorkItem,
): { name: string; state: StepState; detail: string }[] {
  const rec = item.result.recommendation;
  const gates = requestGates(item.result);
  const failing = gates?.gates.filter((gate) => !gate.passed).length ?? 0;
  const clarifying = item.status === "clarifying";
  const stopped = item.status === "human_review" && item.result.loop?.status === "human_review";
  return [
    {
      name: "Understand",
      state: clarifying ? "current" : stopped ? "blocked" : "done",
      detail: clarifying
        ? "Questions open"
        : stopped
          ? "Not clear after 3 rounds"
          : "Intent confirmed",
    },
    {
      name: "Evidence",
      state: rec.evidence.length ? "done" : "pending",
      detail: rec.evidence.length ? `${rec.evidence.length} cited rows` : "No rows cited yet",
    },
    {
      name: "Decide",
      state: rec.action === "human_review" ? "blocked" : clarifying ? "pending" : "done",
      detail: rec.action === "human_review" ? "Needs a person" : ACTIONS[rec.action].label,
    },
    {
      name: "Govern",
      state: !gates || gates.passed ? "done" : item.remediation?.passed_after ? "done" : "blocked",
      detail: !gates
        ? "No spec gates apply"
        : gates.passed
          ? `All ${gates.gates.length} gates pass`
          : item.remediation?.passed_after
            ? "Passes with the simulated owner"
            : `${failing} of ${gates.gates.length} gates blocked`,
    },
    {
      name: "Approve",
      state:
        item.status === "approved" || item.status === "rejected"
          ? "done"
          : item.status === "awaiting_approval"
            ? "current"
            : "pending",
      detail:
        item.status === "approved"
          ? "Approved and recorded"
          : item.status === "rejected"
            ? "Rejected and recorded"
            : item.status === "awaiting_approval"
              ? "Awaiting an approver"
              : "After the steps above",
    },
  ];
}

export function DecisionSteps({ item }: { item: WorkItem }) {
  return (
    <ol aria-label="Decision progress" className="mb-8 grid min-w-0 gap-2 sm:grid-cols-5">
      {decisionSteps(item).map((step, index) => {
        const meta = STEP_META[step.state];
        const Icon = meta.icon;
        return (
          <li key={step.name} className={`${meta.tone} min-w-0 rounded-lg border px-3 py-3`}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              {index + 1}. {step.name}
              <span className="sr-only">: {meta.label}.</span>
            </p>
            <p className="mt-1 text-xs">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

// Which component made each part of the result: the decision backend, and the model tier that read the intent and wrote
// the explanation. Old results without these fields say so instead of guessing.
export function DecisionSource({ result }: { result: RecommendResult }) {
  const backend = result.decision_backend;
  const ai = result.ai;
  const decided =
    backend === "kserve"
      ? "Decided by the KServe InferenceService reuse-gate-kserve on OpenShift AI"
      : backend === "local_fallback"
        ? `Decided in the API process because KServe gave no usable answer (${result.decision_backend_reason ?? "unknown reason"})`
        : backend === "local"
          ? "Decided by the rules engine in the API process"
          : "Decision path not recorded for this result";
  const reader = (
    source: string | undefined,
    tier: string | null | undefined,
    model?: string | null,
  ) =>
    source !== "llm"
      ? "the rules"
      : `${tier && tier !== "rules" ? `the ${tier} tier` : "a model"}${model ? ` (${model})` : ""}`;
  const failed = [...new Set((ai?.tiers_failed ?? []).map((entry) => entry.tier).filter(Boolean))];
  return (
    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t pt-4 text-xs">
      <span className="inline-flex items-center gap-2">
        <Server aria-hidden className="h-4 w-4 shrink-0" />
        {decided}
      </span>
      {ai && (
        <span className="inline-flex items-center gap-2">
          <Cpu aria-hidden className="h-4 w-4 shrink-0" />
          Intent read by {reader(ai.intent_source, ai.tier, ai.model)}; explanation by{" "}
          {reader(ai.explanation_source, ai.explanation_tier)}
          {failed.length ? `; unavailable: ${failed.join(", ")}` : ""}
        </span>
      )}
    </div>
  );
}

// The top bar status: where decisions run right now, from GET /health. Opens to show the details a reviewer asks for.
export function SystemStatus({ offline }: { offline: boolean }) {
  const health = useResource(getHealth, offline ? "offline" : "live");
  const data = health.data;
  if (offline || data?.status === "demo")
    return (
      <span className="tone-amber rounded-full border px-3 py-1 font-semibold">
        Offline demo data
      </span>
    );
  if (!data)
    return (
      <span className="tone-gray rounded-full border px-3 py-1 font-semibold">Checking API...</span>
    );
  if (data.status === "down")
    return (
      <span className="tone-red rounded-full border px-3 py-1 font-semibold">API unreachable</span>
    );
  const kserve = data.decision_backend === "kserve";
  const reach =
    data.kserve_reachable === true
      ? "reachable"
      : data.kserve_reachable === false
        ? "not reachable"
        : "not checked";
  return (
    <details className="relative">
      <summary className="tone-green cursor-pointer list-none rounded-full border px-3 py-1 font-semibold">
        Live API · {kserve ? "decisions on KServe" : "decisions in API"}
      </summary>
      <dl className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-lg border bg-card p-4 text-xs shadow-panel">
        <div>
          <dt className="text-muted-foreground">Decisions</dt>
          <dd>
            {kserve
              ? `KServe InferenceService reuse-gate-kserve, ${reach}. If it fails, the API decides and the result says local_fallback.`
              : `Rules engine in the API process. KServe endpoint ${reach}.`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Estate snapshot</dt>
          <dd className="break-all font-mono">
            {data.estate_snapshot ? data.estate_snapshot.slice(0, 19) : "Not reported"}
            {data.assets !== undefined ? ` · ${data.assets} assets` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Model tiers with a key</dt>
          <dd>
            {data.llm_tiers === undefined
              ? "Not reported"
              : data.llm_tiers.length
                ? data.llm_tiers.join(", ")
                : "None, rules only"}
          </dd>
        </div>
        <p className="text-muted-foreground">
          Models only read intent and word explanations. Decisions never depend on them.
        </p>
      </dl>
    </details>
  );
}
