import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMetric, modelAttribution } from "@/lib/evaluation";
import { EvaluationPage } from "@/components/product/EvaluationPage";
import mock from "@/data/mock_api.json";
import { renderProduct } from "./render-product";
const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getEvaluation: () => load(),
  isDemo: () => true,
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});
describe("evaluation measurements", () => {
  it.each([
    [{ value: 0.937, n: 1098, unit: "share" }, "93.7%"],
    [{ value: 0, n: 9, unit: "share" }, "0%"],
    [{ value: 1098, n: 1098, unit: "citations" }, "1,098"],
    [{ value: null, n: 10, unit: "share" }, "Not measured"],
    [{ value: 1, n: 0, unit: "share" }, "Not measured"],
    [{ value: "not run", n: 10, unit: "share" }, "Not measured"],
  ])("formats %o", (metric, expected) => expect(formatMetric(metric)).toBe(expected));
  it("keeps model names from method rather than assuming a provider", () => {
    expect(
      modelAttribution(
        "Checks facts. Generated explanations by openai/gpt-oss-120b on Together AI.",
      ),
    ).toBe("Generated explanations by openai/gpt-oss-120b on Together AI.");
    expect(modelAttribution("meta-llama/Llama-3.3-70B-Instruct as judge; prompt elsewhere")).toBe(
      "meta-llama/Llama-3.3-70B-Instruct as judge",
    );
    expect(modelAttribution("rules only")).toBeNull();
  });
  it("shows a not-measured reason and all method details", async () => {
    load.mockResolvedValue({
      ...mock.evaluation,
      groups: [{ group: "generation", metrics: [mock.evaluation.groups[1]!.metrics[1]] }],
    });
    const { container } = render(<EvaluationPage />);
    expect(await screen.findByText("Not measured")).toBeInTheDocument();
    expect(screen.getByText("not run")).toBeInTheDocument();
    expect(screen.getByText(/meta-llama\/Llama-3.3-70B-Instruct as judge;/)).toBeInTheDocument();
    const details = container.querySelector("details")!;
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(screen.getByText("Basis")).toBeVisible();
    expect(screen.getByText("Caveat")).toBeVisible();
  });
  it("renders the route and its persistent offline banner", async () => {
    load.mockResolvedValue(mock.evaluation);
    await renderProduct("/evaluation");
    expect(await screen.findByRole("heading", { name: "How we measure Reuse Gate" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("Offline demo data");
    expect(await screen.findByText("93.7%")).toBeVisible();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((e) => e.textContent);
    expect(headings).toEqual([
      "Impact: modelled outcomes",
      "Generation: Faithfulness and Answer relevance",
      "Retriever: Context precision and Context recall",
      "Intent and decisions",
      "Data quality",
      "Human-labelled checks",
    ]);
  });
  it("offers a recovery when measurements fail", async () => {
    load.mockRejectedValue(new Error("Evaluation unavailable"));
    render(<EvaluationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Evaluation unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
