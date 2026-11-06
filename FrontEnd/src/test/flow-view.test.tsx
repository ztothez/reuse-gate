import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowView } from "@/components/gate/FlowView";
import { ResultView } from "@/components/gate/ResultView";
import { exampleRequests, mockRecommend } from "@/lib/api";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("flow view", () => {
  const stages = mockRecommend("Create a global Nubeqa dashboard").pipeline!;

  it("shows the five stages in order", () => {
    expect(stages.map((s) => s.stage)).toEqual(["Intent", "Evidence", "Decision", "Spec", "Gates"]);
    render(<FlowView stages={stages} />);
    const names = within(screen.getByRole("list", { name: "Pipeline stages" })).getAllByRole("button").map((b) => b.textContent);
    ["Intent", "Evidence", "Decision", "Spec", "Gates"].forEach((name, i) => expect(names[i]).toContain(name));
  });

  it("shows the input and output of whichever stage is selected", () => {
    render(<FlowView stages={stages} />);
    for (const stage of ["Intent", "Evidence", "Decision", "Spec", "Gates"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${stage}`) }));
      expect(screen.getByRole("region", { name: `${stage} input` })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: `${stage} output` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /^Gates/ }));
    expect(within(screen.getByRole("region", { name: "Gates output" })).getByText("canonical_kpis")).toBeInTheDocument();
  });

  it("opens on the stage that needs attention", () => {
    const blocked = stages.map((s) => (s.stage === "Gates" ? { ...s, status: "fail" as const } : { ...s, status: "ok" as const }));
    render(<FlowView stages={blocked} />);
    expect(screen.getByRole("button", { name: /^Gates/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("target card", () => {
  it("lists the covered KPIs with their Asset_KPI_Map ids and the asset name note", () => {
    const result = exampleRequests.map(mockRecommend).find((r) => r.recommendation.target?.coverage?.covered.length);
    const coverage = result!.recommendation.target!.coverage!;
    render(<ResultView result={result!} />);
    coverage.covered.forEach((c) => expect(screen.getByText(c.map_id)).toBeInTheDocument());
    expect(screen.getByText(/^Asset names in the data pack are not used for matching/)).toBeInTheDocument();
  });
});

describe("api client", () => {
  it("surfaces a 4xx from the live API instead of switching to demo data", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
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
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const api = await import("@/lib/api");
    const result = await api.recommend("Create a global Nubeqa dashboard");
    expect(result.request_id).toBe("REQ-0001");
    expect(api.isDemo()).toBe(true);
  });
});
