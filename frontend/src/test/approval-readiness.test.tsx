import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalReadiness } from "@/components/gate/ApprovalReadiness";
import { GateComparison } from "@/components/gate/GateComparison";
import type { Owner, RemediationResult } from "@/lib/api";
import { oncology, owners, simulation } from "./remediation-fixtures";

const api = vi.hoisted(() => ({ getOwners: vi.fn(), canRemediate: vi.fn(), remediate: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
function Harness() {
  const [selection, setSelection] = useState<Owner | null>(null);
  const [checked, setChecked] = useState<RemediationResult | null>(null);
  return <ApprovalReadiness result={oncology} owner={selection?.owner_id ?? ""} selection={selection} onSelect={setSelection} reviewBy="2027-11-07" simulation={checked} simulationCurrent onChecked={setChecked} onChecking={() => {}} />;
}
beforeEach(() => { api.getOwners.mockResolvedValue(owners); api.canRemediate.mockReturnValue(true); api.remediate.mockResolvedValue(simulation); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("approval readiness", () => {
  it("does not claim a pass for a decision without spec gates", () => {
    render(<GateComparison simulation={{ ...simulation, before: { owner: null, gates: { passed: null, gates: [] } }, after: { owner: null, gates: { passed: null, gates: [] } }, diff: [], fixed: [], still_failing: [], passed_before: null, passed_after: null }} />);
    expect(screen.getAllByText("No spec gates apply to this decision.")).toHaveLength(2);
    expect(screen.getByText("No gate changes in this simulation.")).toBeInTheDocument();
    expect(screen.queryByText("All gates pass in this simulation.")).toBeNull();
  });
  it("shows all four steps and the original blocker", async () => {
    render(<Harness />);
    const steps = within(screen.getByRole("list", { name: "Approval readiness steps" }));
    for (const step of ["Request confirmed", "Evidence checked", "Gates", "Owner"]) expect(steps.getByText(step)).toBeInTheDocument();
    expect(steps.getByText("No open questions")).toBeInTheDocument();
    expect(steps.getByText("6 cited rows")).toBeInTheDocument();
    expect(steps.getByText("5 of 7 gates passing")).toBeInTheDocument();
    expect(steps.getByText("owner_and_review_date, evidence_cited")).toBeInTheDocument();
    expect(await screen.findByText("Active owner required")).toBeInTheDocument();
    expect(screen.getByText(/Original blocker/)).toBeInTheDocument();
  });
  it("suggests model owners first, highlights market fit, and permits every active owner", async () => {
    render(<Harness />);
    const picker = screen.getByRole("combobox");
    await waitFor(() => expect(picker).toBeEnabled());
    const groups = within(picker).getAllByRole("group");
    expect(groups[0]).toHaveAttribute("label", "Semantic Model Owners (suggested)");
    expect(within(groups[0]!).getAllByRole("option")[0]).toHaveTextContent("Laura Fischer");
    expect(screen.getByRole("option", { name: /Laura Fischer/ })).toHaveClass("bg-secondary");
    fireEvent.change(picker, { target: { value: "OWN-002" } });
    expect(picker).toHaveValue("OWN-002");
    expect(screen.getByText(/gate does not enforce scope fit/)).toBeInTheDocument();
  });
  it("posts one checked assignment and retains before, after and the original blocker", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "OWN-039" } });
    fireEvent.click(screen.getByRole("button", { name: "Recheck gates (simulation)" }));
    expect(await screen.findByText("Simulated. Nothing in the BI tool or the estate has changed.")).toBeInTheDocument();
    expect(api.remediate).toHaveBeenCalledWith(expect.objectContaining({ intent: { products: ["All Pharma"], market: "Global", kpis: ["Net Sales", "Net Sales Growth"], kind: "new_report" }, remediations: [{ type: "assign_owner", target: "SM-065", owner_id: "OWN-039" }] }));
    expect(api.remediate.mock.calls[0]![0]).not.toHaveProperty("owner");
    expect(within(screen.getByRole("region", { name: "Before simulation" })).getByText("5 of 7 gates passing")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "After simulation" })).getByText("7 of 7 gates passing")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Gate changes" })).toHaveTextContent("Blocked to Passed");
    expect(screen.getByText(/Original blocker/)).toBeInTheDocument();
  });
  it("keeps gates that still fail visible", async () => {
    api.remediate.mockResolvedValue({ ...simulation, after: simulation.before, still_failing: ["evidence_cited"], passed_after: false });
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "OWN-039" } });
    fireEvent.click(screen.getByRole("button", { name: "Recheck gates (simulation)" }));
    expect(await screen.findByText("Still blocked in this simulation: evidence_cited")).toBeInTheDocument();
  });
  it("shows a plain live API notice in demo mode without fabricating a simulation", async () => {
    api.canRemediate.mockReturnValue(false);
    render(<Harness />);
    expect(screen.getByText(/simulation needs the live API/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "OWN-039" } });
    expect(screen.getByRole("button", { name: "Recheck gates (simulation)" })).toBeDisabled();
    expect(api.remediate).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Simulation record" })).toBeNull();
  });
});
