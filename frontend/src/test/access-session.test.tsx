import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderProduct } from "./render-product";

// Enforced mode: the API knows two codes. The app shows only what the signed-in role may open.
const CODES: Record<string, { role: string; name: string }> = {
  "analyst-code-123": { role: "analyst", name: "Ana Analyst" },
};
vi.mock("@/lib/api", async (original) => {
  const real = await original<typeof import("@/lib/api")>();
  return {
    ...real,
    getMe: async (code = real.getAccessCode()) => {
      const hit = CODES[code];
      return hit ? { ...hit, enforced: true } : null;
    },
  };
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

describe("signing in with a role code", () => {
  it("asks for a code, refuses a wrong one, and signs in as the role the API names", async () => {
    await renderProduct("/");
    expect(
      await screen.findByRole("heading", { name: "Sign in to Reuse Gate" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Access code"), { target: { value: "wrong-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not valid");
    fireEvent.change(screen.getByLabelText("Access code"), {
      target: { value: "analyst-code-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Ana Analyst")).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Analyst"]);
    expect(screen.queryByRole("link", { name: /Approvals/ })).toBeNull();
    expect(sessionStorage.getItem("reuse-gate-sessions")).toContain("analyst");
    expect(localStorage.getItem("reuse-gate-sessions")).toBeNull();
  });
});
