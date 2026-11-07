import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBadge, STATUS } from "@/components/product/shared";
import { renderProduct } from "./render-product";
import mock from "@/data/mock_api.json";
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), isDemo: () => true, getRequests: async () => mock.work_items.list, getRequest: async () => mock.work_items.detail["SAMPLE-07"], getHealth: async () => ({ status: "demo" }) }));
afterEach(() => { cleanup(); localStorage.clear(); });
describe("product shell", () => {
  it.each([["/", "Your request workspace"], ["/requests", "Requests"], ["/requests/SAMPLE-07", mock.work_items.detail["SAMPLE-07"].text], ["/approvals", "Approval queue"], ["/overview", "Executive overview"], ["/radar", "Governance radar"], ["/log", "Decision log"], ["/admin", "Admin settings"]])("renders %s", async (path, heading) => {
    await renderProduct(path!);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Offline demo data");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
  it("opens the creation form from a deep link query", async () => {
    await renderProduct("/requests?create=1");
    expect(await screen.findByLabelText("What report do you need?")).toBeInTheDocument();
  });
  it.each(Object.entries(STATUS))("labels %s with text and an icon", (status, meta) => {
    const { container } = render(<StatusBadge status={status as keyof typeof STATUS} />);
    expect(screen.getByText(meta.label)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
