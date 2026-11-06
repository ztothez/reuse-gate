import mock from "@/data/mock_api.json";

export type Action =
  | "reuse" | "repair_and_reuse" | "extend" | "migrate"
  | "retire_and_reuse" | "new_build" | "human_review" | "retire";

export interface Asset {
  id: string; name: string; type?: string; platform?: string;
  endorsement?: string; status?: string; views_3m?: number; users_3m?: number; owner?: string | null;
  coverage?: Coverage; reason?: string; citations?: string[];
}
export interface Coverage {
  requested: string[];
  covered: { kpi: string; map_id: string; kpi_id: string; kpi_name: string; definition_status: string; usage_role: string }[];
  missing: string[];
  note: string;
}
export interface Evidence { table: string; id: string; note: string }
export interface RecommendResult {
  request_id: string;
  text: string;
  intent: { products: string[]; market: string; kpis: string[]; kind: string; clarifications: string[]; questions?: Question[] };
  recommendation: {
    action: Action; target: Asset | null; build_on: string | null;
    retire: Asset[]; retire_note?: string | null; consolidate_later?: Asset[]; consolidate_note?: string | null; repair: (string | Asset)[]; rationale: string[]; evidence: Evidence[];
  };
  ai?: { intent_source: "llm" | "rules"; explanation_source: "llm" | "rules"; explanation: string[]; model?: string | null };
  answers?: Answer[];
  pipeline?: PipelineStage[];
}
export interface Question { text: string; field: string }
export interface Answer { field: string; question: string; answer: string }
export interface PipelineStage {
  stage: "Intent" | "Evidence" | "Decision" | "Spec" | "Gates";
  status: "ok" | "needs_input" | "skipped" | "pass" | "fail";
  summary: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}
export interface GateResult { passed: boolean; gates: { gate: string; passed: boolean; detail: string }[] }
export interface DashboardSpec {
  title: string; purpose: string; products: string[]; market: string; kpis: string[];
  semantic_model: string; source_action: "new_build" | "extend"; governance: string[];
  target?: string | null; owner?: string | null; review_date?: string | null;
  measures?: { kpi_id: string; name: string; source: string }[]; evidence?: Record<string, Evidence[]>;
}
export interface RadarAsset { id: string; name: string; views_3m: number; endorsement: string; status: string; reason: string }
export interface Radar {
  totals: {
    assets: number; kpis: number; kpi_status: Record<string, number>;
    ownerless: number; high_reach_uncertified: number; dead_or_unused: number;
  };
  kpi_conflicts: { metric: string; variants: { id: string; name: string; status: string }[] }[];
  ownerless_assets: RadarAsset[];
  high_reach_uncertified: RadarAsset[];
  dead_assets: RadarAsset[];
}
export interface ApprovePayload {
  request_id: string; decision: "approve" | "reject"; approver: string; owner: string; review_by: string; answers?: Answer[];
}

const data = mock as unknown as { requests: RecommendResult[]; radar: Radar };
export const exampleRequests = data.requests.map((r) => r.text);

const API = (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "");
let demo = !API;
const listeners = new Set<(d: boolean) => void>();
export const isDemo = () => demo;
export const onDemoChange = (fn: (d: boolean) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const setDemo = () => { if (!demo) { demo = true; listeners.forEach((l) => l(true)); } };

async function call<T>(path: string, init: RequestInit | undefined, fallback: () => T): Promise<T> {
  if (API) {
    let rejected = "";
    try {
      const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json" } });
      if (res.status >= 400 && res.status < 500) rejected = `The API rejected the request (${res.status}).`;
      else if (!res.ok) throw new Error(String(res.status));
      else return (await res.json()) as T;
    } catch { setDemo(); }
    // A rejected request is an answer from the live API: never replace it with demo data.
    if (rejected) throw new Error(rejected);
  }
  await new Promise((r) => setTimeout(r, 600));
  return fallback();
}

export function mockRecommend(text: string): RecommendResult {
  const q = text.trim().toLowerCase();
  const hit = data.requests.find((r) => {
    const head = r.text.toLowerCase().slice(0, 30);
    return q.includes(head) || (q.length > 0 && head.includes(q.slice(0, 30)));
  });
  return hit ?? data.requests[0]!;
}

export const recommend = (text: string, answers: Answer[] = []) =>
  call<RecommendResult>("/recommend", { method: "POST", body: JSON.stringify({ text, answers }) }, () => mockRecommend(text));

export const getRadar = () => call<Radar>("/radar", undefined, () => data.radar);

export const approve = (p: ApprovePayload) =>
  call<{ ok: boolean; registered_id: string }>("/approve", { method: "POST", body: JSON.stringify(p) }, () => ({
    ok: true,
    registered_id: `DEC-${Date.now().toString(36).toUpperCase()}`,
  }));

export const generateSpec = (result: RecommendResult, owner: string, reviewBy: string) =>
  call<{ spec: DashboardSpec; gates?: GateResult }>("/spec", {
    method: "POST",
    body: JSON.stringify({ intent: result.intent, recommendation: result.recommendation, owner, review_by: reviewBy }),
  }, () => {
    if (result.recommendation.action !== "new_build" && result.recommendation.action !== "extend") {
      throw new Error("DashboardSpec is only available for build decisions");
    }
    return {
      spec: {
        title: result.recommendation.target ? `Extended ${result.recommendation.target.name}` : `${result.intent.products.join(", ")} dashboard`,
        purpose: `Governed view of ${result.intent.kpis.join(", ")} for ${result.intent.products.join(", ")} in ${result.intent.market}.`,
        products: result.intent.products, market: result.intent.market, kpis: result.intent.kpis,
        semantic_model: result.recommendation.build_on ?? "",
        source_action: result.recommendation.action,
        governance: ["Use canonical KPI definitions only", "Register an owner and review date before release", "Keep evidence and approval in the decision log"],
      },
    };
  });
