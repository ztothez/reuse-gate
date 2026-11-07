import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleSwitcher } from "@/components/gate/RoleSwitcher";
import { renderProduct } from "./render-product";
import { DEFAULT_ROLE, readRole, ROLE_KEY, roleTab, saveRole, useRole } from "@/lib/role";
import mock from "@/data/mock_api.json";

// Open mode (no role codes): the role is the viewer's choice. Enforced mode is covered in access-session.test.tsx.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getMe: async () => ({ role: "admin", name: "Local user", enforced: false }),
}));

function Harness() {
  const [role, setRole] = useRole();
  return (
    <>
      <RoleSwitcher role={role} onChange={setRole} />
      <p data-testid="current">{role}</p>
    </>
  );
}

const select = () => screen.getByLabelText("Viewing as");

describe("viewing as", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers five roles and starts as Business", () => {
    render(<Harness />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Business",
      "Analyst",
      "Developer",
      "Approver",
      "Admin",
    ]);
    expect(select()).toHaveValue("business");
    expect(screen.getByText(/the API controls who can approve/)).toBeInTheDocument();
  });

  it("switches role and keeps it in localStorage", () => {
    render(<Harness />);
    fireEvent.change(select(), { target: { value: "approver" } });
    expect(select()).toHaveValue("approver");
    expect(localStorage.getItem(ROLE_KEY)).toBe("approver");
  });

  it("restores the stored role, and maps roles saved by earlier versions", async () => {
    localStorage.setItem(ROLE_KEY, "developer");
    render(<Harness />);
    expect(await screen.findByText("developer")).toBeInTheDocument();
    for (const [old, now] of [
      ["requester", "business"],
      ["executive", "business"],
      ["steward", "admin"],
    ]) {
      localStorage.setItem(ROLE_KEY, old!);
      expect(readRole()).toBe(now);
    }
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
    fireEvent.change(select(), { target: { value: "admin" } });
    expect(screen.getByTestId("current")).toHaveTextContent("admin");
  });

  it("changes the home page with the role", async () => {
    await renderProduct("/");
    expect(
      await screen.findByRole("heading", {
        name: "Before you build a dashboard, check what already exists",
      }),
    ).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "approver" } });
    expect(screen.getByRole("heading", { name: "Decisions that need you" })).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "admin" } });
    expect(screen.getByRole("heading", { name: "Admin settings" })).toBeInTheDocument();
  });

  it("opens the request on the tab for the role", async () => {
    expect(
      ["business", "analyst", "developer", "approver", "admin"].map((r) => roleTab(r as never)),
    ).toEqual(["answer", "evidence", "spec", "gates", "activity"]);
    localStorage.setItem(ROLE_KEY, "developer");
    await renderProduct("/requests/SAMPLE-07");
    expect(await screen.findByRole("tab", { name: "Spec" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("All Pharma dashboard")).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "analyst" } });
    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("columnheader", { name: "Supports" })).toBeInTheDocument();
    expect(
      mock.work_items.detail["SAMPLE-07"].result.recommendation.evidence.length,
    ).toBeGreaterThan(0);
  });
});

describe("role home pages", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
  it(
    "gives the analyst an evidence workspace and the developer a build queue",
    { timeout: 15000 },
    async () => {
      localStorage.setItem(ROLE_KEY, "analyst");
      await renderProduct("/");
      expect(
        await screen.findByRole("heading", { name: "Evidence workspace" }, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole(
          "heading",
          { name: "Conflicting KPI definitions" },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      fireEvent.change(select(), { target: { value: "developer" } });
      expect(
        await screen.findByRole("heading", { name: "Build queue" }, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(
        (await screen.findAllByRole("link", { name: "Open spec" }, { timeout: 5000 })).length,
      ).toBeGreaterThan(0);
    },
  );
});
