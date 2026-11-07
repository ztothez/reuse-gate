import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderProduct } from "./render-product";
import { ROLE_KEY } from "@/lib/role";
import type { ConfigChange } from "@/lib/studio";

// recharts measures its container; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Open mode: the role is chosen in "Viewing as". Each role's workspace reads only its own endpoint.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getMe: async () => ({ role: "admin", name: "Local user", enforced: false }),
}));

const change: ConfigChange = {
  id: "CHG-1",
  status: "proposed",
  settings: { low_views: 300 },
  kpi_synonyms: [],
  market_aliases: {},
  reason: "Unused should mean fewer than 300 views",
  impact: {
    before: { total: 150, avoided: 57, actions: {}, clarifications: 0 },
    after: { total: 150, avoided: 51, actions: {}, clarifications: 0 },
    changed: [
      {
        request_id: "REQ-0004",
        before: "extend",
        after: "new_build",
        before_target: "AST-1",
        after_target: null,
      },
    ],
    changed_count: 7,
  },
  proposed_by: "Dev Developer",
  created: "2026-11-07T22:00:00Z",
  decided_by: null,
  decided: null,
  comment: null,
  patch: null,
};
const studio = vi.hoisted(() => ({
  proposeChange: vi.fn(),
  queryTile: vi.fn(),
  emailReport: vi.fn(),
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  getCatalog: async () => [
    {
      id: "sales",
      label: "Product and market monthly",
      source: "Product_Market_Monthly",
      dimensions: [
        { id: "month", label: "Month" },
        { id: "product", label: "Product" },
      ],
      measures: [{ id: "net_sales", label: "Net sales (M EUR)", unit: "M EUR" }],
    },
  ],
  getDashboards: async () => [],
  queryTile: studio.queryTile,
  getReport: async () => ({
    title: "Reuse Gate executive report",
    generated_at: "2026-11-07T22:00:00Z",
    headline: "Of 150 report requests, 57 (38%) can be met without a new build.",
    sections: [
      {
        title: "Build less",
        text: "Of 150 report requests, 57 (38%) can be met without a new build.",
        source: "evaluation",
      },
      {
        title: "State of the report estate",
        text: "We hold 360 reports.",
        source: "Analytics_Assets",
      },
    ],
    actions: ["Assign an active owner to SM-065."],
    figures: { avoided: 57, requests: 150, assets: 360, unused: 206, ownerless: 86 },
    sales_by_product: [{ product: "Xarelto", net_sales: 1725.2, forecast: 1700 }],
    data_note: "Built from Bayer's synthetic data pack.",
    text: "",
  }),
  emailReport: studio.emailReport,
  getOperations: async () => ({
    generated_at: "2026-11-07T22:00:00Z",
    usage_month: "2026-10-01",
    failed_refresh: [
      {
        id: "SM-021",
        name: "Product Market Performance 21",
        owner: "Mika Weber",
        owner_active: false,
      },
    ],
    query_errors: [],
    supply_lowest_otif: [],
    supply_risk: { red: 29 },
    open_high_signals: { MISSING_OWNER: 18 },
    queue: { awaiting_approval: 2, human_review: 1, clarifying: 0 },
    sources: ["Semantic_Models"],
  }),
  getConfig: async () => ({
    tunables: [
      {
        key: "low_views",
        label: "Views in 3 months below which a report counts as unused",
        value: 100,
        min: 10,
        max: 1000,
        type: "int",
      },
    ],
    kpis: ["Net Sales"],
    kpi_synonyms: [],
    markets: ["DE"],
    market_aliases: {},
    changes: [change],
  }),
  proposeChange: studio.proposeChange,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("each role has its own workspace", () => {
  it("the analyst builds a dashboard tile from real rows and names the source", async () => {
    studio.queryTile.mockResolvedValue({
      dataset: "sales",
      source: "Product_Market_Monthly",
      dimension: "month",
      split: null,
      measure: "net_sales",
      measure_label: "Net sales (M EUR)",
      unit: "M EUR",
      rows: [{ month: "2026-01-01", value: 1200.5 }],
      truncated: false,
    });
    localStorage.setItem(ROLE_KEY, "analyst");
    await renderProduct("/dashboards");
    expect(await screen.findByRole("heading", { name: "Dashboard studio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dashboards/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Add tile/ }));
    expect(await screen.findByText(/Source: Product_Market_Monthly, 1 rows/)).toBeInTheDocument();
    expect(studio.queryTile).toHaveBeenCalledWith(
      expect.objectContaining({ dataset: "sales", measure: "net_sales", dimension: "month" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit tile" }));
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "table" } });
    expect(within(screen.getByRole("table")).getByText("1200.5")).toBeInTheDocument();
  });

  it("the executive gets a plain report that can be printed and emailed", async () => {
    studio.emailReport.mockResolvedValue({ status: "not_configured" });
    localStorage.setItem(ROLE_KEY, "executive");
    await renderProduct("/");
    expect(await screen.findByRole("heading", { name: "Executive report" })).toBeInTheDocument();
    expect(await screen.findByText(/57 \(38%\)/)).toBeInTheDocument();
    expect(screen.getByText("Assign an active owner to SM-065.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Configuration/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Email this report/ }));
    expect(await screen.findByText(/Email is not set up/)).toBeInTheDocument();
  });

  it("the operator sees only the wall, in large type, with owners to call", async () => {
    localStorage.setItem(ROLE_KEY, "operator");
    await renderProduct("/");
    expect(await screen.findByRole("heading", { name: "Operations wall" })).toBeInTheDocument();
    expect(await screen.findByText(/Mika Weber/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Requests/ })).toBeNull();
  });

  it("the developer proposes a measured change and the approver sees its impact", async () => {
    studio.proposeChange.mockResolvedValue(change);
    localStorage.setItem(ROLE_KEY, "developer");
    await renderProduct("/config");
    expect(
      await screen.findByRole("heading", { name: "Decision configuration" }),
    ).toBeInTheDocument();
    fireEvent.change(await screen.findByPlaceholderText("100"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Why"), {
      target: { value: "Unused should mean fewer than 300 views" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Measure impact/ }));
    expect(studio.proposeChange).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { low_views: 300 } }),
    );
    expect(screen.queryByRole("button", { name: /Approve for next release/ })).toBeNull();
    cleanup();
    localStorage.setItem(ROLE_KEY, "approver");
    await renderProduct("/config");
    expect(await screen.findByText(/7 decisions change/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve for next release/ })).toBeInTheDocument();
  });
});
