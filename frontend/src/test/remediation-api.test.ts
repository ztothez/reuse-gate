import { afterEach, describe, expect, it, vi } from "vitest";

const payload = { intent: { products: ["All Pharma"], market: "Global", kpis: ["Net Sales"], kind: "new_report" }, remediations: [{ type: "assign_owner" as const, target: "SM-065", owner_id: "OWN-039" }] };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("remediation API honesty", () => {
  it("lists mock owners but never simulates in demo mode", async () => {
    vi.stubEnv("VITE_API_URL", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/api");
    expect((await api.getOwners()).some(o => o.owner_id === "OWN-039")).toBe(true);
    await expect(api.remediate(payload)).rejects.toThrow(/needs the live API/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("posts the confirmed intent and assignment to the live API", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    const result = { applied: "simulated", before: { gates: { passed: false, gates: [] } }, after: { gates: { passed: true, gates: [] } } };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result))); vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/api");
    expect(await api.remediate(payload)).toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("http://local.test/remediate", expect.objectContaining({ body: JSON.stringify(payload) }));
  });
  it("never replaces an error or an unconfirmed response with a simulation", async () => {
    vi.stubEnv("VITE_API_URL", "http://local.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Inactive owner", applied: "nothing" }), { status: 400 })).mockResolvedValueOnce(new Response(JSON.stringify({ applied: "nothing" }))));
    const api = await import("@/lib/api");
    await expect(api.remediate(payload)).rejects.toThrow("Inactive owner");
    await expect(api.remediate(payload)).rejects.toThrow(/did not confirm/);
  });
});
