import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("access code transport", () => {
  it("uses only the write header and gives an actionable 401 error", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"access code required"}', { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/api");
    api.saveAccessCode("session-test-value");
    await expect(
      api.approve({
        request_id: "WI-1",
        decision: "approve",
        approver: "A",
        owner: "OWN-039",
        review_by: "2099-01-01",
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: "Access code required. Enter it in Admin settings.",
    });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0].includes(api.getAccessCode())).toBe(false);
    expect(new Headers(call[1].headers).get("X-Access-Code") === api.getAccessCode()).toBe(true);
    expect(String(call[1].body).includes(api.getAccessCode())).toBe(false);
  });
});
