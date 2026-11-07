import type { EvaluationMetric } from "./api";

export const EVALUATION_GROUPS = [
  "impact",
  "generation",
  "retrieval",
  "intent and decisions",
  "data",
  "human-labelled",
];
export const GROUP_LABELS: Record<string, string> = {
  impact: "Impact: modelled outcomes",
  generation: "Generation: Faithfulness and Answer relevance",
  retrieval: "Retriever: Context precision and Context recall",
  "intent and decisions": "Intent and decisions",
  data: "Data quality",
  "human-labelled": "Human-labelled checks",
};
export function formatMetric(
  metric: Pick<EvaluationMetric, "value" | "n" | "unit">,
  locale = "en",
) {
  if (
    metric.n === 0 ||
    metric.value === null ||
    typeof metric.value !== "number" ||
    !Number.isFinite(metric.value)
  )
    return "Not measured";
  if (metric.unit === "share")
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
      metric.value,
    );
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(metric.value);
  return metric.unit === "%" || metric.unit === "percent" ? `${number}%` : number;
}
const MEANINGS: Record<string, string> = {
  new_builds_avoided: "Requests whose proposed route is something other than a new build.",
  new_builds_avoided_canonical_only:
    "How the avoided-build count changes when only shared KPI definitions qualify.",
  requests_and_texts: "How many request rows and distinct prompts support this evaluation.",
  citations_valid: "Cited rows that were checked against the data pack.",
  specs_passing_today: "Proposed specifications that meet every recorded governance rule.",
  specs_passing_after_owner_fix:
    "Specifications that would pass if an active owner were assigned in a simulation.",
  estate_assets_today: "The current asset count in the data pack.",
  estate_assets_with_gate: "Projected asset count if every proposed route were carried out.",
  estate_assets_no_check: "Projected asset count if each request became a new asset.",
  faithfulness_deterministic:
    "Whether the explanation's named facts appear in its decision or cited rows.",
  faithfulness_judge:
    "Whether a separate model judges the explanation to be supported by its evidence.",
  guard_replacement_rate: "How often the explanation guard would replace generated wording.",
  answer_relevance: "Whether explanations name the requested action, target and measures.",
  context_precision: "How much of the retrieved evidence is relevant under the stated rule.",
  context_recall: "How much of the evidence defined as required was retrieved.",
  intent_accuracy_first: "Whether the first reading matches the author-written expected request.",
  intent_accuracy_after_loop: "Whether the reading matches after simulated helpful answers.",
  kpi_precision_first: "How many measures identified on the first reading were expected.",
  kpi_recall_first: "How many expected measures were identified on the first reading.",
  kpi_precision_after_loop: "How many identified measures were expected after clarification.",
  kpi_recall_after_loop: "How many expected measures were identified after clarification.",
  citation_validity:
    "Whether each citation points to an existing row, rather than whether it proves a claim.",
  referential_integrity: "Whether references between tables point to existing rows.",
  null_rate: "How many cells are empty, including fields that are optional by design.",
  ownerless_assets: "Assets with a missing, unknown or inactive owner.",
  duplicate_asset_names: "Assets that share their name with another asset.",
  non_canonical_kpis: "Measure definitions that differ from the shared approved definition.",
  gold_action_accuracy: "Whether a human label agrees with the proposed action.",
  gold_target_accuracy: "Whether a human label agrees with the proposed target.",
  gold_kpi_precision: "How many identified measures a human labeller expected.",
  gold_kpi_recall: "How many human-expected measures were identified.",
  gold_context_precision: "How much cited evidence a human labeller considers relevant.",
};
export function metricMeaning(metric: EvaluationMetric) {
  return (
    MEANINGS[metric.id] ??
    (metric.id.startsWith("agreement")
      ? "How often two ways of reading a request propose the same action. Agreement is not accuracy."
      : `What this measures: ${metric.name.toLowerCase()}. Read the method and limits below.`)
  );
}
export function modelAttribution(method: string) {
  return (
    method.match(/Generated explanations by (.+)$/)?.[0] ??
    method.match(/^[^;]+?(?:as judge|judges each distinct explanation[^;]*)/)?.[0] ??
    null
  );
}
