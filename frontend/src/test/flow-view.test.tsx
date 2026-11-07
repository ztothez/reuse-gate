import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowView } from "@/components/gate/FlowView";
import { ResultView } from "@/components/gate/ResultView";
import { exampleRequests, mockRecommend, type ClarificationLoop } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("clarification loop in the flow view", () => {
  const stages = mockRecommend("Create a global Nubeqa dashboard").pipeline!;
  const loop = (over: Partial<ClarificationLoop>): ClarificationLoop => ({
    status: "clear",
    rounds_used: 1,
    max_rounds: 3,
    clear_at: 0.8,
    confidence: {
      product: { value: ["Nubeqa"], score: 1, basis: "named" },
      market: { value: "Global", score: 0.4, basis: "assumed" },
    },
    open_fields: [],
    asked_by: "rules",
    phrased_by: null,
    stopped_because: null,
    rounds: [
      {
        round: 1,
        questions: [{ field: "market", text: "no market was named" }],
        answers: [{ field: "market", question: "no market was named", answer: "Germany" }],
        intent: null,
        intent_after: null,
        changed: [{ field: "market", from: "Global", to: "DE" }],
      },
    ],
    ...over,
  });

  it("shows rounds, answers, the diff between rounds and the confidence of each field", () => {
    render(<FlowView stages={stages} loop={loop({})} prompt="messy text" />);
    const round = within(screen.getByRole("listitem", { name: "Round 1" }));
    expect(round.getByText("no market was named")).toBeInTheDocument();
    expect(round.getByText("Answer: Germany")).toBeInTheDocument();
    expect(round.getByText("Global")).toHaveClass("line-through");
    expect(round.getByText(/DE/)).toBeInTheDocument();
    const confidence = within(screen.getByRole("region", { name: "Clarification loop" }));
    expect(confidence.getByText(/40% \(assumed\)/)).toBeInTheDocument();
    expect(screen.getByText("Intent clear")).toBeInTheDocument();
  });

  it("uses Bayer's legend labels and colours", () => {
    render(<FlowView stages={stages} loop={loop({})} prompt="messy text" agentic />);
    const legend = within(screen.getByRole("list", { name: "Legend" }));
    const tones = {
      "User input": "tone-orange",
      "Agentic skill": "tone-yellow",
      "Deterministic Python": "tone-green",
      "Process state": "tone-blue",
    };
    for (const [name, tone] of Object.entries(tones))
      expect(legend.getByText(name)).toHaveClass(tone);
    const top = within(screen.getByRole("list", { name: "Prompt to Intent" }));
    expect(top.getByText("User input")).toBeInTheDocument();
    expect(top.getByText("Agentic skill")).toBeInTheDocument();
    const row = within(screen.getByRole("list", { name: "Pipeline stages" }));
    expect(
      within(row.getByRole("button", { name: /^Intent/ })).getByText("Process state"),
    ).toBeInTheDocument();
    expect(
      within(row.getByRole("button", { name: /^Spec/ })).getByText("Process state"),
    ).toBeInTheDocument();
    const decision = within(row.getByRole("button", { name: /^Decision/ }));
    expect(decision.getByText("Deterministic Python")).toBeInTheDocument();
    expect(decision.getByText("Our addition")).toBeInTheDocument();
  });

  it("says rules only when no model was involved, and says why it stopped", () => {
    render(
      <FlowView
        stages={stages}
        prompt="messy"
        loop={loop({
          status: "human_review",
          rounds_used: 3,
          stopped_because: "still unclear after 3 rounds",
        })}
      />,
    );
    const top = within(screen.getByRole("list", { name: "Prompt to Intent" }));
    expect(top.getByText("Deterministic Python")).toBeInTheDocument();
    expect(top.getByText(/Rules only/)).toBeInTheDocument();
    expect(screen.getByText("Sent to a person")).toBeInTheDocument();
    expect(screen.getByText(/still unclear after 3 rounds/)).toBeInTheDocument();
  });
});

describe("flow view", () => {
  const stages = mockRecommend("Create a global Nubeqa dashboard").pipeline!;

  it("shows the five stages in order", () => {
    expect(stages.map((s) => s.stage)).toEqual(["Intent", "Evidence", "Decision", "Spec", "Gates"]);
    render(<FlowView stages={stages} />);
    const names = within(screen.getByRole("list", { name: "Pipeline stages" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    ["Intent", "Evidence", "Decision", "Spec", "Gates"].forEach((name, i) =>
      expect(names[i]).toContain(name),
    );
  });

  it("shows the input and output of whichever stage is selected", () => {
    render(<FlowView stages={stages} />);
    for (const stage of ["Intent", "Evidence", "Decision", "Spec", "Gates"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${stage}`) }));
      expect(screen.getByRole("region", { name: `${stage} input` })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: `${stage} output` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /^Gates/ }));
    expect(
      within(screen.getByRole("region", { name: "Gates output" })).getByText("canonical_kpis"),
    ).toBeInTheDocument();
  });

  it("opens on the stage that needs attention", () => {
    const blocked = stages.map((s) =>
      s.stage === "Gates" ? { ...s, status: "fail" as const } : { ...s, status: "ok" as const },
    );
    render(<FlowView stages={blocked} />);
    expect(screen.getByRole("button", { name: /^Gates/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("target card", () => {
  it("lists the covered KPIs with their Asset_KPI_Map ids and the asset name note", () => {
    const result = exampleRequests
      .map(mockRecommend)
      .find((r) => r.recommendation.target?.coverage?.covered.length);
    const coverage = result!.recommendation.target!.coverage!;
    render(<ResultView result={result!} />);
    coverage.covered.forEach((c) => expect(screen.getByText(c.map_id)).toBeInTheDocument());
    expect(
      screen.getByText(/^Asset names in the data pack are not used for matching/),
    ).toBeInTheDocument();
  });
});

describe("source line", () => {
  const base = mockRecommend("Create a global Nubeqa dashboard");
  const withAi = (ai: Partial<NonNullable<typeof base.ai>>) => ({
    ...base,
    ai: { ...base.ai!, ...ai },
  });

  it("says clearly when the rule baseline answered, and shows the result rather than an error", () => {
    const notice = "AI models did not respond, so the rule baseline answered.";
    render(<ResultView result={withAi({ source: "rules", reason: "unavailable", notice })} />);
    const line = screen.getByRole("note");
    expect(line).toHaveTextContent("Source: rules.");
    expect(line).toHaveTextContent(notice);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Recommendation")).toBeInTheDocument();
  });

  it("marks a chip's saved rule-based reading as rules", () => {
    render(
      <ResultView
        result={withAi({
          source: "rules",
          reason: "saved_rules",
          cached: true,
          model: null,
          notice: "Saved reading.",
        })}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Source: rules, saved answer.");
  });

  it("names the model and a saved answer", () => {
    render(
      <ResultView
        result={withAi({
          source: "llm",
          model: "openai/gpt-oss-120b",
          cached: true,
          reason: null,
          notice: null,
        })}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "Source: AI (openai/gpt-oss-120b), saved answer.",
    );
  });
});

describe("secondary KPI mappings", () => {
  it("shows them on the target card as not counted", () => {
    const result = exampleRequests
      .map(mockRecommend)
      .find((r) => r.recommendation.target?.coverage)!;
    const row = {
      kpi: "Net Sales",
      map_id: "AST-1:KPI-2",
      kpi_id: "KPI-2",
      kpi_name: "Net Sales",
      definition_status: "canonical",
      usage_role: "secondary",
    };
    const target = {
      ...result.recommendation.target!,
      coverage: {
        ...result.recommendation.target!.coverage!,
        covered: [],
        secondary_only: [row],
        missing: ["Net Sales"],
      },
    };
    render(
      <ResultView result={{ ...result, recommendation: { ...result.recommendation, target } }} />,
    );
    expect(screen.getByText(/Secondary only, not counted/)).toBeInTheDocument();
    expect(screen.getByText("AST-1:KPI-2")).toBeInTheDocument();
  });
});

describe("retire and consolidate lists", () => {
  const assets = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix} ${i}`,
      reason: `why ${prefix} ${i}`,
      citations: [],
    }));
  const withLists = (retire: number, later: number) => {
    const base = mockRecommend("Create a global Nubeqa dashboard");
    return {
      ...base,
      recommendation: {
        ...base.recommendation,
        retire: assets("R", retire),
        consolidate_later: assets("C", later),
        consolidate_note: "migrate users first, owner review required",
      },
    };
  };

  it("caps each list at 5 and counts the rest", () => {
    render(<ResultView result={withLists(7, 12)} />);
    ["R-4", "C-4"].forEach((id) => expect(screen.getByText(id)).toBeInTheDocument());
    ["R-5", "C-5"].forEach((id) => expect(screen.queryByText(id)).not.toBeInTheDocument());
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.getByText("+7 more")).toBeInTheDocument();
  });

  it("shows no count at exactly 5, and the required note on the consolidate list", () => {
    render(<ResultView result={withLists(5, 1)} />);
    expect(screen.getByText("R-4")).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ more$/)).not.toBeInTheDocument();
    expect(screen.getByText(/migrate users first, owner review required/)).toBeInTheDocument();
    expect(screen.getByText("why C 0")).toBeInTheDocument();
  });

  it("words a new build's retire list as waiting for the new asset", () => {
    const result = withLists(1, 0);
    render(
      <ResultView
        result={{
          ...result,
          recommendation: {
            ...result.recommendation,
            action: "new_build",
            retire_note: "retire after the new asset is live",
          },
        }}
      />,
    );
    expect(screen.getByText(/retire after the new asset is live/)).toBeInTheDocument();
  });

  it("hides the panels when the lists are empty", () => {
    render(<ResultView result={withLists(0, 0)} />);
    expect(screen.queryByRole("heading", { name: "Retire" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Consolidate later" })).not.toBeInTheDocument();
  });
});

describe("api client", () => {
  it("surfaces a 4xx from the live API instead of switching to demo data", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 400 })),
    );
    const api = await import("@/lib/api");
    await expect(api.recommend("anything at all")).rejects.toThrow("400");
    expect(api.isDemo()).toBe(false);
  });

  it("sends clarification answers to the live API", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/api");
    const answers = [{ field: "market", question: "q", answer: "Germany" }];
    await api.recommend("some request text", answers);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ text: "some request text", answers });
  });

  it("falls back to demo data only when the API is unreachable", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const api = await import("@/lib/api");
    const result = await api.recommend("Create a global Nubeqa dashboard");
    expect(result.request_id).toBe("REQ-0001");
    expect(api.isDemo()).toBe(true);
  });
});
