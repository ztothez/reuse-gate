import { describe, expect, it } from "vitest";
import mock from "@/data/mock_api.json";
import type { WorkItemRow } from "@/lib/api";
import { filterRequests } from "@/lib/request-filters";
const rows = mock.work_items.list as WorkItemRow[];
describe("request table filters", () => {
  it("filters by status, owner, origin and creation date together", () => {
    const row = rows.find(item => item.status === "awaiting_approval")!;
    const filtered = filterRequests(rows, { status: row.status, owner: row.owner ?? "unassigned", origin: "sample", from: "2026-11-07", to: "2026-11-07" });
    expect(filtered.map(item => item.request_id)).toEqual([row.request_id]);
    expect(filterRequests(rows, { origin: "user" })).toEqual([]);
    expect(filterRequests(rows, { from: "2030-01-01" })).toEqual([]);
  });
  it("sorts by owner without mutating API rows", () => {
    const original = rows.map(row => row.request_id);
    const sorted = filterRequests(rows, { sort: "owner" });
    expect(sorted.map(row => row.owner ?? "")).toEqual(rows.map(row => row.owner ?? "").sort((a,b) => a.localeCompare(b)));
    expect(rows.map(row => row.request_id)).toEqual(original);
  });
  it("supports request search and target links", () => {
    expect(filterRequests(rows, { q: "oncology" })[0]?.request_id).toBe("SAMPLE-07");
    expect(filterRequests(rows, { target: "SM-065" }).every(row => row.target === "SM-065")).toBe(true);
  });
});
