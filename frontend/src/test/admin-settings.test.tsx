import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSettings } from "@/components/product/AdminSettings";
import { ACCESS_CODE_KEY } from "@/lib/api";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getHealth: async () => ({ status: "live", assets: 360 }),
  getProviderInfo: async () => ({}),
  getOwners: async () => [],
}));
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("Admin session settings", () => {
  it("keeps access only in sessionStorage and never in the URL or console", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const before = window.location.href;
    render(<AdminSettings />);
    const input = screen.getByLabelText("Access code");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "test-session-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save session access" }));
    expect(
      await screen.findByText("Access code saved for this browser session."),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(ACCESS_CODE_KEY)).toBe("test-session-value");
    expect(localStorage.getItem(ACCESS_CODE_KEY)).toBeNull();
    expect(window.location.href).toBe(before);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it("shows missing provider status as unknown", async () => {
    render(<AdminSettings />);
    await waitFor(() =>
      expect(screen.getAllByText("Unknown (not provided by API)")).toHaveLength(4),
    );
    expect(screen.getByText("Live API, 360 assets loaded")).toBeInTheDocument();
  });
});
