import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderProduct } from "./render-product";
import mock from "@/data/mock_api.json";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getRequests: async () => mock.work_items.list,
  getRequest: async () => mock.work_items.detail["SAMPLE-07"],
  findModelRequest: async () => mock.work_items.list.find((row) => row.request_id === "SAMPLE-07"),
  getRadar: async () => mock.radar,
  getOwners: async () => mock.owners,
  isDemo: () => true,
}));
afterEach(cleanup);
describe("Executive evidence", () => {
  it("links headline numbers to their lists and distinguishes asset certification from owner status", async () => {
    await renderProduct("/overview");
    expect(await screen.findByText("Proposed routes avoiding a new build")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Proposed routes avoiding/ })).toHaveAttribute(
      "href",
      expect.stringContaining("action=existing"),
    );
    expect(screen.getByRole("link", { name: /Requests awaiting a decision/ })).toHaveAttribute(
      "href",
      "/approvals",
    );
    expect(screen.getByText(/Certified-owner status is not reported/)).toBeInTheDocument();
    expect(screen.getByText(/modelled spec blockers/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck gates (simulation)" })).toBeDisabled();
  });
});
