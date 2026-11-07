import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionRecordView } from "@/components/gate/DecisionRecordView";
import { DecisionLog } from "@/components/gate/DecisionLog";
import type { DecisionRecord, LogRecord } from "@/lib/api";
import { toEntry } from "@/lib/decision-log";
import { oncology, simulation } from "./remediation-fixtures";

const api = vi.hoisted(() => ({ getLog: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
afterEach(cleanup);
const record: DecisionRecord = { estate_snapshot: simulation.estate_snapshot, request_text: oncology.text, approver: "Local Approver", owner: "OWN-039", review_by: "2099-12-01", decision: "approve", rounds: [{ round: 1, questions: [], answers: [], intent: null, intent_after: null, changed: [] }], intent: oncology.intent, recommendation: oncology.recommendation, gates: { before_remediation: simulation.before.gates, at_approval: simulation.after.gates }, remediation: simulation };
const row: LogRecord = { request_id: oncology.request_id, registered_id: "LOCAL-1", time: "2026-11-07T10:00:00Z", decision: "approve", approver: record.approver, owner: record.owner, review_by: record.review_by, record };

describe("decision records", () => {
  it("preserves the complete record for JSON export", () => {
    expect(toEntry(row).record).toEqual(record);
    expect(JSON.stringify(toEntry({ ...row, mode: "demo" }))).toContain('"mode":"demo"');
  });
  it.each(["live", "demo"] as const)("expands a %s record with before and after gate evidence", async (origin) => {
    api.getLog.mockResolvedValue([{ ...row, ...(origin === "demo" ? { mode: "demo" } : {}) }]);
    render(<DecisionLog />);
    fireEvent.click(await screen.findByRole("button", { name: "View record LOCAL-1" }));
    const details = within(screen.getByRole("region", { name: "Decision record" }));
    expect(details.getByText(oncology.text)).toBeInTheDocument();
    expect(details.getByText("Clarification rounds").nextElementSibling).toHaveTextContent("1");
    expect(details.getByText(origin)).toBeInTheDocument();
    expect(details.getByText("sha256:1234567890ab")).toBeInTheDocument();
    expect(details.getByRole("region", { name: "Before remediation" })).toHaveTextContent("5 of 7 gates passing");
    expect(details.getByRole("region", { name: "At approval" })).toHaveTextContent("7 of 7 gates passing");
    expect(details.getByText(/Laura Fischer/)).toBeInTheDocument();
    expect(details.getByText("Simulated. Nothing in the BI tool or the estate has changed.")).toBeInTheDocument();
  });
  it("uses saved gate snapshots even when the remediation summary was recomputed", () => {
    const final = { passed: false, gates: simulation.after.gates.gates.map((gate) => gate.gate === "evidence_cited" ? { ...gate, passed: false, detail: "Owner evidence still required" } : gate) };
    render(<DecisionRecordView origin="live" record={{ ...record, gates: { before_remediation: simulation.before.gates, at_approval: final }, remediation: { ...simulation, before: simulation.after } }} />);
    expect(screen.getByRole("region", { name: "Before remediation" })).toHaveTextContent("5 of 7 gates passing");
    expect(screen.getByRole("region", { name: "At approval" })).toHaveTextContent("6 of 7 gates passing");
    expect(screen.getByRole("region", { name: "At approval" })).toHaveTextContent("Owner evidence still required");
    expect(screen.getByText("Original blockers: owner_and_review_date, evidence_cited.")).toBeInTheDocument();
    expect(screen.getByText(/Laura Fischer/)).toBeInTheDocument();
  });
  it("shows gate history without requiring remediation metadata", () => {
    render(<DecisionRecordView origin="live" record={{ ...record, remediation: null }} />);
    expect(screen.getByRole("region", { name: "Before remediation" })).toHaveTextContent("5 of 7 gates passing");
    expect(screen.getByRole("region", { name: "At approval" })).toHaveTextContent("7 of 7 gates passing");
  });
  it.each([simulation.after.gates, { at_approval: simulation.after.gates }])("shows only the final gates when before_remediation is missing", (gates) => {
    render(<DecisionRecordView origin="live" record={{ ...record, gates }} />);
    expect(screen.getByRole("region", { name: "At approval" })).toHaveTextContent("7 of 7 gates passing");
    expect(screen.queryByRole("region", { name: "Before remediation" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Before simulation" })).toBeNull();
    expect(screen.queryByText(/Original blockers/)).toBeNull();
    expect(screen.queryByText("5 of 7 gates passing")).toBeNull();
  });
  it("can show the final remediation verdict when no gate snapshot was recorded", () => {
    render(<DecisionRecordView origin="live" record={{ ...record, gates: null }} />);
    expect(screen.getByRole("region", { name: "At approval" })).toHaveTextContent("7 of 7 gates passing");
    expect(screen.queryByRole("region", { name: "Before remediation" })).toBeNull();
  });
  it("renders old log entries without a record", async () => {
    const { record: ignored, ...legacy } = row;
    api.getLog.mockResolvedValue([legacy]);
    render(<DecisionLog />);
    expect(await screen.findByText("No detailed record")).toBeInTheDocument();
    expect(screen.getByText(oncology.request_id)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Decision record" })).toBeNull();
  });
});
