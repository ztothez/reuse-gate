import { describe, expect, it } from "vitest";
import { mockRecommend } from "@/lib/api";
import { newBuildsAvoided, type LogEntry } from "@/lib/decision-log";

const e = (action: LogEntry["action"], decision: LogEntry["decision"]) =>
  ({ id: Math.random().toString(), time: "", text: "", action, target: "", decision, approver: "", owner: "", review_by: "" }) as LogEntry;

describe("reuse gate rules", () => {
  it("counts only approved non-new_build decisions as builds avoided", () => {
    expect(newBuildsAvoided([e("extend", "approve"), e("new_build", "approve"), e("reuse", "reject")])).toBe(1);
  });
  it("mock recommend matches by the first 30 characters, else falls back to the first request", () => {
    expect(mockRecommend("please create a power bi replacement for x").request_id).toBe("REQ-0002");
    expect(mockRecommend("something unrelated").request_id).toBe("REQ-0001");
  });
});
