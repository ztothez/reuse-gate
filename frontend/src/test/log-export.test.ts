import { describe, expect, it } from "vitest";
import { decisionCsv } from "@/lib/log-export";
import type { LogEntry } from "@/lib/decision-log";
describe("visible log CSV", () => {
  it("quotes text and includes provenance without evaluating spreadsheet expressions", () => {
    const row: LogEntry = {
      id: "1",
      time: "2026-11-07",
      text: '=SUM(1,2) "report"',
      action: "reuse",
      target: "Report",
      decision: "approve",
      approver: "A",
      owner: "B",
      review_by: "2027-01-01",
      mode: "demo",
    };
    const csv = decisionCsv([row]);
    expect(csv).toContain('"Origin"');
    expect(csv).toContain('"demo"');
    expect(csv).toContain("'=SUM(1,2)");
    expect(csv).toContain('""report""');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
  it("exports only the supplied visible rows", () => {
    expect(decisionCsv([]).split("\r\n")).toHaveLength(1);
  });
});
