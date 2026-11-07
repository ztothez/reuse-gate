import { afterEach, describe, expect, it } from "vitest";
import mock from "@/data/mock_api.json";
import { localItems, resetWorkCache, storageNotice, WORK_CACHE_KEY } from "@/lib/work-item-cache";
afterEach(() => {
  resetWorkCache();
  localStorage.clear();
});
describe("offline work item cache", () => {
  it.each(['{"items":3}', '[{"request_id":"broken"}]', "invalid json"])(
    "ignores invalid saved shape %s",
    (value) => {
      localStorage.setItem(WORK_CACHE_KEY, value);
      expect(localItems()).toHaveLength(10);
      expect(storageNotice()).toMatch(/Invalid saved requests/);
    },
  );
  it.each([{ rounds: ["malformed"] }, { status: "approved" }, { local_only: false }])(
    "ignores malformed or falsely approved local drafts",
    (change) => {
      localStorage.setItem(
        WORK_CACHE_KEY,
        JSON.stringify([
          {
            ...mock.work_items.detail["SAMPLE-07"],
            request_id: "LOCAL-bad",
            local_only: true,
            ...change,
          },
        ]),
      );
      expect(localItems().find((item) => item.request_id === "LOCAL-bad")).toBeUndefined();
      expect(storageNotice()).toMatch(/Invalid saved requests/);
    },
  );
  it("keeps seeded samples separate from real user requests", () => {
    expect(localItems().every((item) => item.origin === "sample")).toBe(true);
    expect(localItems().filter((item) => item.status === "awaiting_approval")).toHaveLength(1);
  });
});
