import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleSwitcher } from "@/components/gate/RoleSwitcher";
import { Route } from "@/routes/index";
import { DEFAULT_ROLE, readRole, ROLE_KEY, saveRole, useRole } from "@/lib/role";

function Harness() {
  const [role, setRole] = useRole();
  return (
    <>
      <RoleSwitcher role={role} onChange={setRole} />
      <p data-testid="current">{role}</p>
    </>
  );
}

const roleButtons = () =>
  within(screen.getByRole("group", { name: "Role" })).getAllByRole("button");

describe("role switcher", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers the four roles and starts as Requester", () => {
    render(<Harness />);
    expect(roleButtons().map((b) => b.textContent)).toEqual([
      "Requester",
      "Approver",
      "Steward",
      "Admin",
    ]);
    expect(screen.getByRole("button", { name: "Requester" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/real deployment takes the role from SSO groups/)).toBeInTheDocument();
  });

  it("switches role and keeps it in localStorage", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Approver" }));
    expect(screen.getByRole("button", { name: "Approver" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Requester" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(localStorage.getItem(ROLE_KEY)).toBe("approver");
  });

  it("restores the stored role on the next visit", () => {
    localStorage.setItem(ROLE_KEY, "steward");
    render(<Harness />);
    expect(screen.getByTestId("current")).toHaveTextContent("steward");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem(ROLE_KEY, "superuser");
    expect(readRole()).toBe(DEFAULT_ROLE);
  });

  it("keeps working when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readRole()).toBe(DEFAULT_ROLE);
    expect(() => saveRole("admin")).not.toThrow();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByTestId("current")).toHaveTextContent("admin");
  });

  it("shows a different view per role on the page", async () => {
    // The Admin view reads /health and /log: keep the test off the network.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const Page = Route.options.component!;
    render(<Page />);
    expect(screen.getByLabelText("What report do you need?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approver" }));
    expect(screen.getByText(/No request to decide yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Steward" }));
    expect(screen.getByLabelText(/Describe the dashboard/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByRole("tab", { name: "Decision log" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Radar" })).toBeInTheDocument();
    await screen.findByText(/Health \(GET \/health\)/);
  });
});
