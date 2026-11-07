import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewRequest } from "@/components/gate/NewRequest";
import type { RecommendResult } from "@/lib/api";

const recommend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), recommend }));

const TEXT = "Nubeqa net sales report please.";
const QUESTION = "no market was named: searched all markets (Global), please confirm";

function make(id: string, market: string, action: string, questions: { text: string; field: string }[], answers: RecommendResult["answers"] = []) {
  return {
    request_id: id, text: TEXT, answers,
    intent: { products: ["Nubeqa"], market, kpis: ["Net Sales"], kind: "new_report", clarifications: questions.map((q) => q.text), questions },
    recommendation: { action, target: null, build_on: null, retire: [], repair: [], rationale: [`decided for ${market}`], evidence: [] },
  } as unknown as RecommendResult;
}

async function submit() {
  fireEvent.change(screen.getByLabelText(/Describe the dashboard/), { target: { value: TEXT } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByLabelText(QUESTION);
}

describe("clarification loop", () => {
  beforeEach(() => recommend.mockReset());
  afterEach(cleanup);

  it("re-runs the request with the answer and replaces the result", async () => {
    recommend.mockResolvedValueOnce(make("A", "Global", "repair_and_reuse", [{ text: QUESTION, field: "market" }]));
    recommend.mockResolvedValueOnce(make("B", "DE", "new_build", [], [{ field: "market", question: QUESTION, answer: "Germany" }]));
    render(<NewRequest />);
    await submit();
    expect(screen.getByText("Repair and reuse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(QUESTION), { target: { value: "Germany" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply answers and check again/ }));

    await screen.findByText("New build on a governed model");
    expect(recommend).toHaveBeenLastCalledWith(TEXT, [{ field: "market", question: QUESTION, answer: "Germany" }]);
    expect(screen.queryByText("Repair and reuse")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByText("DE")).toBeInTheDocument();
  });

  it("sends earlier answers again, because the API keeps no state", async () => {
    const earlier = { field: "product", question: "which product?", answer: "Nubeqa" };
    recommend.mockResolvedValueOnce(make("A", "Global", "human_review", [{ text: QUESTION, field: "market" }], [earlier]));
    recommend.mockResolvedValueOnce(make("B", "FI", "new_build", []));
    render(<NewRequest />);
    await submit();
    fireEvent.change(screen.getByLabelText(QUESTION), { target: { value: "Finland" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply answers/ }));
    await waitFor(() => expect(recommend).toHaveBeenCalledTimes(2));
    expect(recommend.mock.calls[1]![1]).toEqual([earlier, { field: "market", question: QUESTION, answer: "Finland" }]);
  });

  it("cannot re-check without an answer, and can still reject while questions are open", async () => {
    recommend.mockResolvedValueOnce(make("A", "Global", "human_review", [{ text: QUESTION, field: "market" }]));
    render(<NewRequest />);
    await submit();
    expect(screen.getByRole("button", { name: /Apply answers/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Approver name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Report owner"), { target: { value: "B" } });
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("keeps the current result and shows an error if the re-check fails", async () => {
    recommend.mockResolvedValueOnce(make("A", "Global", "repair_and_reuse", [{ text: QUESTION, field: "market" }]));
    recommend.mockRejectedValueOnce(new Error("400"));
    render(<NewRequest />);
    await submit();
    fireEvent.change(screen.getByLabelText(QUESTION), { target: { value: "Germany" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply answers/ }));
    await screen.findByText(/Could not apply your answers/);
    expect(screen.getByText("Repair and reuse")).toBeInTheDocument();
  });
});
