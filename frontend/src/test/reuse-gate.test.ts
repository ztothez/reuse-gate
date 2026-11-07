import { afterEach, describe, expect, it, vi } from "vitest";
import { mockRecommend, type LogRecord } from "@/lib/api";
import { newBuildsAvoided, toEntry, type LogEntry } from "@/lib/decision-log";
import { evidenceSummary } from "@/lib/summaries";

const e = (action: LogEntry["action"], decision: LogEntry["decision"]) =>
  ({
    id: Math.random().toString(),
    time: "",
    text: "",
    action,
    target: "",
    decision,
    approver: "",
    owner: "",
    review_by: "",
  }) as LogEntry;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("reuse gate rules", () => {
  it("counts only approved non-new_build decisions as builds avoided", () => {
    expect(
      newBuildsAvoided([e("extend", "approve"), e("new_build", "approve"), e("reuse", "reject")]),
    ).toBe(1);
  });
  it("does not count a decision whose action the log does not record", () => {
    expect(newBuildsAvoided([e(null, "approve")])).toBe(0);
  });
  it("mock recommend matches by the first 30 characters, else falls back to the first request", () => {
    expect(mockRecommend("please create a power bi replacement for x").request_id).toBe("REQ-0002");
    expect(mockRecommend("something unrelated").request_id).toBe("REQ-0001");
  });
});

describe("decision log from GET /log", () => {
  const row: LogRecord = {
    request_id: "ADHOC-1",
    decision: "approve",
    approver: "A",
    owner: "B",
    review_by: "2027-11-07",
    registered_id: "REG-1",
    time: "2026-11-07T07:33:46+00:00",
  };

  it("shows older API rows without text, action or target", () => {
    expect(toEntry(row)).toMatchObject({
      id: "REG-1",
      text: "ADHOC-1",
      action: null,
      target: "-",
    });
  });

  it("reads the live log from the API", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    const fetcher = vi.fn(async () => new Response(JSON.stringify([row]), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/api");
    expect(await api.getLog()).toEqual([row]);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("http://api.test/log");
  });

  it("keeps demo decisions in memory when the API is unreachable", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const api = await import("@/lib/api");
    const res = await api.approve({ ...row, action: "extend", text: "t", target: "AST-1" });
    const log = await api.getLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ registered_id: res.registered_id, action: "extend" });
  });

  it("reports health honestly and never switches to demo data", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, assets: 360 }), { status: 200 })),
    );
    let api = await import("@/lib/api");
    expect(await api.getHealth()).toEqual({ status: "live", assets: 360 });
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    api = await import("@/lib/api");
    expect(await api.getHealth()).toEqual({ status: "down" });
    expect(api.isDemo()).toBe(false);
  });
});

describe("approver evidence summary", () => {
  it("counts rows and tables and puts estate rows before generic rules", () => {
    const s = evidenceSummary([
      { table: "Governance_Rules", id: "RULE-001", note: "" },
      { table: "Analytics_Assets", id: "AST-1", note: "" },
      { table: "Governance_Rules", id: "RULE-002", note: "" },
      { table: "KPI_Catalog", id: "KPI-1", note: "" },
    ]);
    expect(s).toMatchObject({ rows: 4, tables: 3, rules: 2 });
    expect(s.top.map((r) => r.id)).toEqual(["AST-1", "KPI-1", "RULE-001"]);
  });
});
