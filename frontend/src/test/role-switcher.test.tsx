import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleSwitcher } from "@/components/gate/RoleSwitcher";
import { renderProduct } from "./render-product";
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
  within(screen.getByRole("group", { name: "Lens" })).getAllByRole("button");

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
      "Executive",
      "Admin",
    ]);
    expect(screen.getByRole("button", { name: "Requester" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Lenses change the view/)).toBeInTheDocument();
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
    localStorage.setItem(ROLE_KEY, "executive");
    render(<Harness />);
    expect(screen.getByTestId("current")).toHaveTextContent("executive");
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

  it("shows each lens home in the routed product shell", async () => {
    await renderProduct("/");
    expect(
      await screen.findByRole("heading", {
        name: "Before you build a dashboard, check what already exists",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approver" }));
    expect(screen.getByRole("heading", { name: "Decisions that need you" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Executive" }));
    expect(screen.getByRole("heading", { name: "Executive overview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByRole("heading", { name: "Admin settings" })).toBeInTheDocument();
  });
});
