import { exampleRequests, mockRecommend, type Owner, type RemediationResult } from "@/lib/api";
import { requestGates } from "@/lib/governance";

const batch = mockRecommend(exampleRequests.find((text) => text.includes("comparing product performance"))!);
export const oncology = { ...batch, request_id: "ADHOC-1", intent: { ...batch.intent, market: "Global" } };
export const owners: Owner[] = [
  { owner_id: "OWN-002", owner_name: "Report Lead", role: "Reporting Lead", scope: "ES" },
  { owner_id: "OWN-021", owner_name: "Mika Martin", role: "Semantic Model Owner", scope: "EMEA" },
  { owner_id: "OWN-039", owner_name: "Laura Fischer", role: "Semantic Model Owner", scope: "Global" },
];
const before = requestGates(oncology)!;
export const simulation: RemediationResult = {
  applied: "simulated", estate_snapshot: "sha256:1234567890abcdef", request_id: "ADHOC-1", intent_source: "confirmed intent", as_of: "2026-11-07",
  decision: { action: "new_build", target: null, build_on: "SM-065" },
  remediations: [{ type: "assign_owner", target: "SM-065", owner_id: "OWN-039", owner_name: "Laura Fischer", target_table: "Semantic_Models", from_owner_id: "OWN-037", from_status: "inactive", citations: ["Owners:OWN-039", "Semantic_Models:SM-065"] }],
  before: { owner: null, gates: before },
  after: { owner: "OWN-039", gates: { passed: true, gates: before.gates.map((gate) => ({ ...gate, passed: true, detail: "ok" })) } },
  diff: before.gates.filter((gate) => !gate.passed).map((gate) => ({ gate: gate.gate, before: false, after: true, detail_before: gate.detail, detail_after: "ok" })),
  fixed: ["owner_and_review_date", "evidence_cited"], still_failing: [], passed_before: false, passed_after: true,
};
