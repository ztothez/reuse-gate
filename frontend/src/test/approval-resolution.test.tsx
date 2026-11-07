import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "@/components/gate/ApprovalPanel";
import { oncology, owners, simulation } from "./remediation-fixtures";

const api = vi.hoisted(() => ({
  getOwners: vi.fn(),
  canRemediate: vi.fn(),
  remediate: vi.fn(),
  approve: vi.fn(),
  generateSpec: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  ...api,
}));
beforeEach(() => {
  api.getOwners.mockResolvedValue(owners);
  api.canRemediate.mockReturnValue(true);
  api.remediate.mockResolvedValue(simulation);
  api.approve.mockResolvedValue({ ok: true, registered_id: "LOCAL-1" });
  api.generateSpec.mockResolvedValue({ spec: { title: "Preview" }, gates: simulation.after.gates });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function selectOwner() {
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "OWN-039" } });
  fireEvent.change(screen.getByLabelText("Approver name"), { target: { value: "Local Approver" } });
  fireEvent.change(screen.getByLabelText("Review by"), { target: { value: "2099-12-01" } });
}

describe("approval resolution contract", () => {
  it("prefills the owner, requires a current check, and approves with intent, rounds and only checked remediations", async () => {
    const onDecided = vi.fn();
    render(<ApprovalPanel readiness result={oncology} blocked={false} onDecided={onDecided} />);
    expect(screen.getByText("Enter the approver name.")).toBeInTheDocument();
    await selectOwner();
    expect(screen.getByLabelText("Report owner")).toHaveValue("OWN-039");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Recheck gates (simulation)" }));
    await screen.findByText("All gates pass in this simulation.");
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(api.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "OWN-039",
        review_by: "2099-12-01",
        intent: {
          products: ["All Pharma"],
          market: "Global",
          kpis: ["Net Sales", "Net Sales Growth"],
          kind: "new_report",
        },
        rounds: oncology.loop?.rounds ?? [],
        remediations: [{ type: "assign_owner", target: "SM-065", owner_id: "OWN-039" }],
      }),
    );
    expect(screen.getByText(/Original blocker/)).toBeInTheDocument();
    expect(
      screen.getByText("Simulated. Nothing in the BI tool or the estate has changed."),
    ).toBeInTheDocument();
  });
  it("invalidates approval after changing checked inputs and freezes them during recheck", async () => {
    let resolve!: (value: unknown) => void;
    api.remediate.mockImplementation(
      () =>
        new Promise((callback) => {
          resolve = callback;
        }),
    );
    render(<ApprovalPanel readiness result={oncology} blocked={false} />);
    await selectOwner();
    fireEvent.click(screen.getByRole("button", { name: "Recheck gates (simulation)" }));
    expect(screen.getByLabelText("Review by")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    await act(async () => resolve(simulation));
    fireEvent.change(screen.getByLabelText("Review by"), { target: { value: "2099-12-02" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/This simulation is outdated/)).toBeInTheDocument();
    expect(api.approve).not.toHaveBeenCalled();
  });
  it("keeps approval blocked by open questions while allowing rejection", async () => {
    render(
      <ApprovalPanel
        readiness
        result={{
          ...oncology,
          intent: { ...oncology.intent, questions: [{ field: "market", text: "Which market?" }] },
        }}
        blocked
      />,
    );
    await selectOwner();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Recheck gates (simulation)" })).toBeDisabled();
    expect(screen.getByText("Waiting for answers")).toBeInTheDocument();
  });
});
