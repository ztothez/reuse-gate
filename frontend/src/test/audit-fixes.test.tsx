import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "@/components/gate/ApprovalPanel";
import { exampleRequests, mockRecommend } from "@/lib/api";
import { hasInvalidStoredRole, readRole, ROLE_KEY } from "@/lib/role";
import { useRequestState, type RequestState } from "@/lib/use-request";

const mocked = vi.hoisted(() => ({ approve: vi.fn(), recommend: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...mocked }));
const result = mockRecommend(exampleRequests[0]!);
afterEach(() => { cleanup(); vi.resetAllMocks(); localStorage.clear(); });

function ready() {
  fireEvent.change(screen.getByLabelText("Approver name"), { target: { value: "Approver" } });
  fireEvent.change(screen.getByLabelText("Report owner"), { target: { value: "Owner" } });
}

describe("audit regressions", () => {
  it("does not announce success for ok false or a failed approval", async () => {
    mocked.approve.mockResolvedValueOnce({ ok: false, registered_id: "bad" }).mockRejectedValueOnce(new Error("offline"));
    const onDecided = vi.fn();
    render(<ApprovalPanel result={result} blocked={false} onDecided={onDecided} />);
    ready();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await screen.findByRole("alert");
      expect(onDecided).not.toHaveBeenCalled();
      expect(screen.queryByText(/Registered as/)).toBeNull();
    }
  });

  it("requires a valid review date and freezes submitted values while pending", async () => {
    let resolve!: (value: unknown) => void;
    mocked.approve.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<ApprovalPanel result={result} blocked={false} />);
    ready();
    const date = screen.getByLabelText("Review by");
    fireEvent.change(date, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.change(date, { target: { value: "2099-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(date).toBeDisabled();
    expect(screen.getByLabelText("Report owner")).toBeDisabled();
    await act(async () => resolve({ ok: true, registered_id: "DEMO-1", mode: "demo" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Owner: Owner · Review by 2099-12-01");
    expect(screen.getByRole("status")).toHaveTextContent(/Demo decision/);
  });

  it("ties freshness to the submitted text and clears it on resubmit", async () => {
    mocked.recommend.mockResolvedValue(result);
    let state!: RequestState;
    function Harness() { state = useRequestState(); return null; }
    render(<Harness />);
    act(() => state.setText("submitted request"));
    await act(async () => state.submit());
    expect(state.outdated).toBe(false);
    act(() => state.setText("edited request"));
    expect(state.outdated).toBe(true);
    await act(async () => state.submit());
    expect(state.outdated).toBe(false);
  });

  it.each(['{"role":"admin"}', '[]', 'null', 'superuser'])("ignores invalid stored role %s", (value) => {
    localStorage.setItem(ROLE_KEY, value);
    expect(readRole()).toBe("requester");
    expect(hasInvalidStoredRole()).toBe(true);
  });
});
