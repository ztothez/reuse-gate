import { describe, expect, it } from "vitest";
import { displayText } from "@/lib/display-text";

describe("displayText", () => {
  it("formats quoted Python lists within explanation strings", () => {
    expect(displayText("Repair ['A', 'B']; why [\"C\", \"D\"]")).toBe("Repair A, B; why C, D");
  });
  it("preserves ordinary text and non-list brackets", () => {
    expect(displayText("Owner's report [draft] [1, 2]")).toBe("Owner's report [draft] [1, 2]");
  });
  it("handles commas and escaped quotes within items", () => {
    expect(displayText("['A, B', 'Owner\\'s KPI']")).toBe("A, B, Owner's KPI");
  });
});
