import type { GateSnapshot, IntentSnapshot, RecommendResult, RemediationPayload } from "./api";

export function requestGates(result: RecommendResult): GateSnapshot | null {
  const output = result.pipeline?.find((stage) => stage.stage === "Gates")?.output;
  if (!output || !Array.isArray(output["gates"])) return null;
  if (output["passed"] !== true && output["passed"] !== false && output["passed"] !== null) return null;
  const gates = output["gates"];
  if (!gates.every((gate) => gate && typeof gate.gate === "string" && typeof gate.passed === "boolean" && typeof gate.detail === "string")) return null;
  return { passed: output["passed"], gates };
}

export function confirmedIntent(result: RecommendResult): IntentSnapshot {
  const { products, market, kpis, kind } = result.intent;
  return { products, market, kpis, kind };
}

export function ownerSimulation(result: RecommendResult, ownerId: string, reviewBy: string): RemediationPayload {
  const target = result.recommendation.build_on ?? result.recommendation.target?.id;
  if (!target) throw new Error("This decision has no model or report to assign an owner to.");
  const asOf = result.pipeline?.find((stage) => stage.stage === "Gates")?.input["as_of"];
  return {
    ...(result.request_id.startsWith("REQ-") ? { request_id: result.request_id } : { intent: confirmedIntent(result) }),
    remediations: [{ type: "assign_owner", target, owner_id: ownerId }],
    review_by: reviewBy,
    ...(typeof asOf === "string" ? { as_of: asOf } : {}),
  };
}
