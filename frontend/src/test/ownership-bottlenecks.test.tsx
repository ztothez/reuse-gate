import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarView } from "@/components/gate/RadarView";
import { OwnershipBottlenecks } from "@/components/gate/OwnershipBottlenecks";
import mock from "@/data/mock_api.json";

const api = vi.hoisted(() => ({ getRadar: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
afterEach(cleanup);

describe("ownership bottlenecks", () => {
  it("puts the ownership card first in Radar and shows modelled counts and citations", async () => {
    api.getRadar.mockResolvedValue(mock.radar);
    const { container } = render(<RadarView />);
    await screen.findByText("Ownership bottlenecks");
    expect(container.querySelector("section h3")).toHaveTextContent("Ownership bottlenecks");
    expect(screen.getByText("80 modelled specs blocked")).toBeInTheDocument();
    const citations = screen.getByText(/View citations for Oliver Schmidt/);
    fireEvent.click(citations);
    expect(citations.parentElement).toHaveAttribute("open");
    expect(screen.getByText("Semantic_Models:SM-065")).toBeInTheDocument();
    expect(screen.queryByText(/unblocked|fixed/i)).toBeNull();
  });
  it("keeps older API responses usable", () => {
    render(<OwnershipBottlenecks />);
    expect(screen.getByText(/not available from this API/)).toBeInTheDocument();
  });
});
