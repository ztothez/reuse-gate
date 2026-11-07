import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionSource, decisionSteps } from "@/components/product/DecisionTrail";
import type { WorkItem } from "@/lib/api";
import mock from "@/data/mock_api.json";
afterEach(cleanup);
const sample = mock.work_items.detail["SAMPLE-07"] as unknown as WorkItem;
describe("decision trail", () => {
  it("reads the five steps from the saved item", () => {
    expect(decisionSteps(sample).map((step) => [step.name, step.state])).toEqual([
      ["Understand", "current"],
      ["Evidence", "done"],
      ["Decide", "pending"],
      ["Govern", "blocked"],
      ["Approve", "pending"],
    ]);
    const approved = {
      ...sample,
      status: "approved",
      remediation: { passed_after: true },
    } as unknown as WorkItem;
    expect(decisionSteps(approved).map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });
  it("says no gates apply when a decision has no spec", () => {
    const repair = mock.work_items.detail["SAMPLE-09"] as unknown as WorkItem;
    const govern = decisionSteps(repair).find((step) => step.name === "Govern")!;
    expect([govern.state, govern.detail]).toEqual(["done", "No spec gates apply"]);
  });
  it("names the decision backend and the tiers that answered", () => {
    const kserve = {
      ...sample.result,
      decision_backend: "kserve",
      ai: {
        ...sample.result.ai!,
        intent_source: "llm",
        tier: "together",
        model: "openai/gpt-oss-120b",
        explanation_source: "llm",
        explanation_tier: "featherless",
        tiers_failed: [{ tier: "together", reason: "timeout", call: "explanation" }],
      },
    } as WorkItem["result"];
    render(<DecisionSource result={kserve} />);
    expect(
      screen.getByText(/KServe InferenceService reuse-gate-kserve on OpenShift AI/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Intent read by the together tier \(openai\/gpt-oss-120b\); explanation by the featherless tier; unavailable: together/,
      ),
    ).toBeInTheDocument();
    cleanup();
    render(
      <DecisionSource
        result={{
          ...sample.result,
          decision_backend: "local_fallback",
          decision_backend_reason: "timeout",
        }}
      />,
    );
    expect(screen.getByText(/KServe gave no usable answer \(timeout\)/)).toBeInTheDocument();
    cleanup();
    const old = { ...sample.result } as Partial<WorkItem["result"]>;
    delete old.decision_backend;
    render(<DecisionSource result={old as WorkItem["result"]} />);
    expect(screen.getByText("Decision path not recorded for this result")).toBeInTheDocument();
  });
});
