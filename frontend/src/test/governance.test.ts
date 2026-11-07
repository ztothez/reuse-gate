import { describe, expect, it } from "vitest";
import { exampleRequests, mockRecommend } from "@/lib/api";
import { ownerSimulation, requestGates } from "@/lib/governance";

const result = mockRecommend(exampleRequests.find((text) => text.includes("comparing product performance"))!);

describe("governance context", () => {
  it("preserves the original gate verdict", () => {
    expect(requestGates(result)?.gates.filter((gate) => !gate.passed).map((gate) => gate.gate)).toEqual(["owner_and_review_date", "evidence_cited"]);
  });
  it("uses a batch request id and assigns the build model without overriding the before owner", () => {
    const payload = ownerSimulation(result, "OWN-039", "2027-11-07");
    expect(payload.request_id).toBe(result.request_id);
    expect(payload.remediations).toEqual([{ type: "assign_owner", target: "SM-065", owner_id: "OWN-039" }]);
    expect(payload).not.toHaveProperty("owner");
    expect(payload).not.toHaveProperty("intent");
  });
  it("uses confirmed intent for an ad hoc request and falls back to the target asset", () => {
    const payload = ownerSimulation({ ...result, request_id: "ADHOC-1", recommendation: { ...result.recommendation, build_on: null, target: { id: "AST-1", name: "Report" } } }, "OWN-039", "2027-11-07");
    expect(payload).not.toHaveProperty("request_id");
    expect(payload.intent).toEqual({ products: result.intent.products, market: result.intent.market, kpis: result.intent.kpis, kind: result.intent.kind });
    expect(payload.remediations[0]?.target).toBe("AST-1");
  });
  it("treats missing or malformed gate data as unknown", () => {
    expect(requestGates({ ...result, pipeline: [] })).toBeNull();
    expect(requestGates({ ...result, pipeline: [{ stage: "Gates", status: "fail", summary: "", input: {}, output: { passed: true, gates: [{}] } }] })).toBeNull();
  });
});
