import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApproverView } from "@/components/gate/ApproverView";
import { RequesterView } from "@/components/gate/RequesterView";
import {
  exampleRequests,
  mockRecommend,
  type ClarificationLoop,
  type RecommendResult,
} from "@/lib/api";
import { useRequestState, type RequestState } from "@/lib/use-request";

const api = vi.hoisted(() => ({ recommend: vi.fn(), canSpeak: vi.fn(() => false) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  ...api,
}));

const base = exampleRequests.map(mockRecommend).find((r) => r.recommendation.action === "extend")!;
const MARKET = "no market was named: searched all markets (Global), please confirm";
const PRODUCT = "read 'nubeca' as Nubeqa: please confirm";
const rounds = [
  {
    round: 1,
    questions: [
      { text: PRODUCT, field: "product" },
      { text: MARKET, field: "market" },
    ],
    answers: [],
    intent: null,
    intent_after: null,
    changed: [],
  },
];
const loop = (over: Partial<ClarificationLoop>): ClarificationLoop => ({
  status: "asking",
  rounds_used: 0,
  max_rounds: 3,
  clear_at: 0.8,
  confidence: {},
  open_fields: ["product", "market"],
  asked_by: "rules",
  phrased_by: null,
  stopped_because: null,
  rounds,
  ...over,
});
const asking = {
  ...base,
  intent: {
    ...base.intent,
    clarifications: [PRODUCT, MARKET],
    questions: [
      { text: PRODUCT, field: "product", phrased: "Did you mean Nubeqa?" },
      { text: MARKET, field: "market" },
    ],
  },
  loop: loop({}),
} as RecommendResult;
const stopped = {
  ...base,
  intent: { ...base.intent, clarifications: [], questions: [] },
  recommendation: {
    ...base.recommendation,
    action: "human_review",
    target: null,
    rationale: ["still unclear after 3 rounds of questions (market), so a person must decide"],
  },
  loop: loop({ status: "human_review", rounds_used: 3, stopped_because: "still unclear" }),
} as unknown as RecommendResult;

let shared: RequestState;
function Both() {
  shared = useRequestState();
  return (
    <>
      <RequesterView state={shared} />
      <ApproverView state={shared} />
    </>
  );
}

async function submit() {
  const box = screen.getByLabelText("What report do you need?");
  fireEvent.change(box, { target: { value: "nubeca sales" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(api.recommend).toHaveBeenCalledTimes(1));
}
const answer = (text: string) => {
  const box = screen.getByLabelText("Your answer");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("role views drive the clarification loop", () => {
  beforeEach(() => api.recommend.mockReset());
  afterEach(cleanup);

  it("collects every open question, then sends one round with the recorded rounds", async () => {
    api.recommend.mockResolvedValueOnce(asking).mockResolvedValueOnce(base);
    render(<Both />);
    await submit();
    expect(await screen.findByText("Question 1 of 2: Did you mean Nubeqa?")).toBeInTheDocument();
    answer("yes");
    expect(await screen.findByText(`Question 2 of 2: ${MARKET}`)).toBeInTheDocument();
    expect(api.recommend).toHaveBeenCalledTimes(1);
    answer("Germany");
    await waitFor(() => expect(api.recommend).toHaveBeenCalledTimes(2));
    expect(api.recommend.mock.calls[1]).toEqual([
      base.text,
      [
        { field: "product", question: PRODUCT, answer: "yes" },
        { field: "market", question: MARKET, answer: "Germany" },
      ],
      rounds,
    ]);
  });

  it("blocks approval while questions are open, and says which round it is", async () => {
    api.recommend.mockResolvedValueOnce(asking);
    render(<Both />);
    await submit();
    await screen.findByText(/round 1 of 3/);
    fireEvent.change(screen.getByLabelText("Approver name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Report owner"), { target: { value: "B" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("shows plainly when the loop ends with a person", async () => {
    api.recommend.mockResolvedValueOnce(stopped);
    render(<Both />);
    await submit();
    expect(
      await screen.findByText(/could not make this request clear after 3 rounds of questions/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Still unclear after 3 rounds of questions/)).toBeInTheDocument();
    expect(screen.getByText("Needs human review")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
  });
});
