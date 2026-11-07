import { afterEach, describe, expect, it, vi } from "vitest";
import mock from "@/data/mock_api.json";
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe("saved request API", () => {
  it("creates a saved item and sends all answers and rounds on a recheck", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    const item = mock.work_items.detail["SAMPLE-07"];
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ request_id: item.request_id, status: item.status, result: item.result }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/api");
    const payload = {
      request_id: item.request_id,
      text: item.text,
      answers: [{ field: "market", question: "Which market?", answer: "yes" }],
      rounds: item.rounds,
    };
    const response = await api.saveRequest(payload as Parameters<typeof api.saveRequest>[0]);
    expect(response.request_id).toBe(item.request_id);
    expect(fetcher).toHaveBeenCalledWith(
      "http://local.test/requests",
      expect.objectContaining({ body: JSON.stringify(payload) }),
    );
  });
  it("keeps unknown offline drafts local without inventing a recommendation or approval", async () => {
    vi.stubEnv("VITE_API_URL", "");
    const api = await import("@/lib/api");
    const saved = await api.saveRequest({ text: "An unmatched request" });
    const item = await api.getRequest(saved.request_id);
    expect(item.local_only).toBe(true);
    expect(item.decision).toBeNull();
    expect(item.result.recommendation.evidence).toEqual([]);
    expect(item.result.recommendation.rationale.join(" ")).toMatch(/not been analysed/);
    await expect(
      api.approve({
        request_id: item.request_id,
        decision: "approve",
        approver: "A",
        owner: "B",
        review_by: "2099-01-01",
      }),
    ).rejects.toThrow(/needs the live API/);
    expect(await api.getLog()).toEqual([]);
  });
  it("does not attach an old recommendation to edited offline text", async () => {
    vi.stubEnv("VITE_API_URL", "");
    const api = await import("@/lib/api");
    const saved = await api.saveRequest({
      request_id: "SAMPLE-07",
      text: "A completely different analysis request",
    });
    const item = await api.getRequest(saved.request_id);
    expect(item.origin).toBe("user");
    expect(item.result.recommendation.action).toBe("human_review");
    expect(item.result.recommendation.target).toBeNull();
    expect(item.result.recommendation.evidence).toEqual([]);
  });
  it("never saves a local draft when the live API is unreachable", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const api = await import("@/lib/api");
    await expect(api.saveRequest({ text: "Offline draft for reload" })).rejects.toThrow(
      /was not saved/,
    );
    expect(api.isDemo()).toBe(false);
  });
  it("confirms model associations from detail without rewriting the list target", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    const row = mock.work_items.list.find((item) => item.request_id === "SAMPLE-07")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(url.endsWith("/requests") ? [row] : mock.work_items.detail["SAMPLE-07"]),
          ),
      ),
    );
    const api = await import("@/lib/api");
    const rows = await api.requestsForView({}, "SM-065");
    expect(rows[0]?.model_id).toBe("SM-065");
    expect(rows[0]?.target).toBe(row.target);
  });
  it("keeps 409 as a conflict instead of creating a local successful item", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 409 })));
    const api = await import("@/lib/api");
    await expect(
      api.saveRequest({ request_id: "CLOSED-1", text: "Request" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(localStorage.getItem("reuse-gate-work-items-v1")).toBeNull();
  });
});
