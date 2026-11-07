import { afterEach, describe, expect, it } from "vitest";
import { localItems, resetWorkCache, storageNotice, WORK_CACHE_KEY } from "@/lib/work-item-cache";
afterEach(() => { resetWorkCache(); localStorage.clear(); });
describe("offline work item cache", () => {
  it.each(['{"items":3}', '[{"request_id":"broken"}]', 'invalid json'])("ignores invalid saved shape %s", (value) => {
    localStorage.setItem(WORK_CACHE_KEY, value);
    expect(localItems()).toHaveLength(10);
    expect(storageNotice()).toMatch(/Invalid saved requests/);
  });
  it("keeps seeded samples separate from real user requests", () => {
    expect(localItems().every(item => item.origin === "sample")).toBe(true);
    expect(localItems().filter(item => item.status === "awaiting_approval")).toHaveLength(1);
  });
});
