import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequesterView } from "@/components/gate/RequesterView";
import { exampleRequests, mockRecommend, type RecommendResult } from "@/lib/api";
import { plainAnswer } from "@/lib/summaries";
import { useRequestState } from "@/lib/use-request";

const api = vi.hoisted(() => ({
  recommend: vi.fn(),
  canSpeak: vi.fn(() => true),
  speak: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  ...api,
}));

const withTarget = exampleRequests
  .map(mockRecommend)
  .find((r) => r.recommendation.target && r.recommendation.action === "extend")!;
const newBuild = exampleRequests
  .map(mockRecommend)
  .find((r) => r.recommendation.action === "new_build")!;
const QUESTION = "no market was named: searched all markets (Global), please confirm";
const withQuestion = {
  ...withTarget,
  intent: {
    ...withTarget.intent,
    clarifications: [QUESTION],
    questions: [{ text: QUESTION, field: "market" }],
  },
} as RecommendResult;

function Harness() {
  return <RequesterView state={useRequestState()} />;
}

const box = () => screen.getByRole("textbox");
async function ask(text = "Market access monthly please") {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(api.recommend).toHaveBeenCalled());
}

describe("requester view", () => {
  beforeEach(() => {
    api.recommend.mockReset();
    api.canSpeak.mockReturnValue(true);
  });
  afterEach(cleanup);

  it("starts with one sentence and the request box, and nothing else", () => {
    const { container } = render(<Harness />);
    expect(screen.getByText(/Tell us what report you need/)).toBeInTheDocument();
    expect(screen.getByLabelText("What report do you need?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this" })).not.toBeInTheDocument();
    expect(container.firstElementChild!.children.length).toBeLessThanOrEqual(3);
  });

  it("submits with Enter and answers with the target and a Use this button", async () => {
    api.recommend.mockResolvedValueOnce(withTarget);
    const { container } = render(<Harness />);
    await ask();
    expect(api.recommend).toHaveBeenCalledWith("Market access monthly please");
    expect(await screen.findByText(plainAnswer(withTarget))).toBeInTheDocument();
    const report = screen.getByRole("region", { name: "Report to use" });
    expect(within(report).getByText(withTarget.recommendation.target!.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this" })).toBeInTheDocument();
    // At most three elements, and no tables.
    expect(container.firstElementChild!.children.length).toBeLessThanOrEqual(3);
    expect(container.querySelector("table")).toBeNull();
  });

  it("does not submit on Shift+Enter, so a new line is still possible", () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: "x" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(api.recommend).not.toHaveBeenCalled();
  });

  it("confirms when the requester chooses to use the report", async () => {
    api.recommend.mockResolvedValueOnce(withTarget);
    render(<Harness />);
    await ask();
    fireEvent.click(await screen.findByRole("button", { name: "Use this" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      `Your approver will confirm access to ${withTarget.recommendation.target!.name}`,
    );
  });

  it("uses large, glove-friendly controls with 20px or larger text", async () => {
    api.recommend.mockResolvedValueOnce(withTarget);
    render(<Harness />);
    await ask();
    await screen.findByRole("button", { name: "Use this" });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Listen", "Use this", "Check", "New request"]),
    );
    for (const b of buttons) {
      expect(b.className).toMatch(/min-h-(16|20)/);
      expect(b.className).toMatch(/text-(xl|2xl)/);
    }
    expect(box().className).toMatch(/text-xl/);
  });

  it("offers no Use this button when nothing can be reused", async () => {
    api.recommend.mockResolvedValueOnce(newBuild);
    render(<Harness />);
    await ask();
    expect(await screen.findByText(plainAnswer(newBuild))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this" })).not.toBeInTheDocument();
  });

  it("asks one open question at a time and sends the answer with Enter", async () => {
    api.recommend.mockResolvedValueOnce(withQuestion).mockResolvedValueOnce(withTarget);
    render(<Harness />);
    await ask();
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Germany" } });
    fireEvent.keyDown(screen.getByLabelText("Your answer"), { key: "Enter" });
    await waitFor(() => expect(api.recommend).toHaveBeenCalledTimes(2));
    expect(api.recommend.mock.calls[1]![1]).toEqual([
      { field: "market", question: QUESTION, answer: "Germany" },
    ]);
    expect(await screen.findByRole("button", { name: "Use this" })).toBeInTheDocument();
  });

  it("confirms Global with the API question and recorded rounds", async () => {
    api.recommend.mockResolvedValueOnce(withQuestion).mockResolvedValueOnce(withTarget);
    render(<Harness />);
    await ask();
    expect(await screen.findByRole("heading", { name: "Please confirm" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type your answer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, use Global" }));
    await waitFor(() => expect(api.recommend).toHaveBeenCalledTimes(2));
    expect(api.recommend.mock.calls[1]![1]).toEqual([
      { field: "market", question: QUESTION, answer: "Global" },
    ]);
  });

  it("explains a failure in the answer sentence", async () => {
    api.recommend.mockRejectedValueOnce(new Error("500"));
    render(<Harness />);
    await ask();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not get a recommendation/);
  });
});
