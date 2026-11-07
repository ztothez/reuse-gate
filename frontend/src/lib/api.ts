import mock from "@/data/mock_api.json";
import { itemRow, localItems, saveLocalItem } from "./work-item-cache";

export type Action =
  | "reuse"
  | "repair_and_reuse"
  | "extend"
  | "migrate"
  | "retire_and_reuse"
  | "new_build"
  | "human_review"
  | "retire";

export interface Asset {
  id: string;
  name: string;
  type?: string;
  platform?: string;
  endorsement?: string;
  status?: string;
  views_3m?: number;
  users_3m?: number;
  owner?: string | null;
  coverage?: Coverage;
  reason?: string;
  citations?: string[];
}
export interface Coverage {
  requested: string[];
  covered: {
    kpi: string;
    map_id: string;
    kpi_id: string;
    kpi_name: string;
    definition_status: string;
    usage_role: string;
  }[];
  secondary_only?: Coverage["covered"];
  missing: string[];
  note: string;
}
export interface Evidence {
  table: string;
  id: string;
  note: string;
}
export interface RecommendResult {
  request_id: string;
  text: string;
  intent: {
    products: string[];
    market: string;
    kpis: string[];
    kind: string;
    clarifications: string[];
    questions?: Question[];
  };
  recommendation: {
    action: Action;
    target: Asset | null;
    build_on: string | null;
    retire: Asset[];
    retire_note?: string | null;
    consolidate_later?: Asset[];
    consolidate_note?: string | null;
    repair: (string | Asset)[];
    rationale: string[];
    evidence: Evidence[];
  };
  ai?: {
    intent_source: "llm" | "rules";
    explanation_source: "llm" | "rules";
    explanation: string[];
    model?: string | null;
    speech?: string;
    source?: "llm" | "rules";
    cached?: boolean;
    reason?: string | null;
    notice?: string | null;
  };
  answers?: Answer[];
  pipeline?: PipelineStage[];
  loop?: ClarificationLoop;
}
export interface Question {
  text: string;
  field: string;
  phrased?: string;
}
export type IntentSnapshot = {
  products: string[];
  market: string;
  kpis: string[];
  kind: string;
  proposed_kpis?: string[];
  blocked?: string | null;
};
export interface LoopRound {
  round: number;
  text?: string;
  questions: Question[];
  answers: (Answer & { used?: boolean; kept?: boolean })[];
  intent: IntentSnapshot | null;
  intent_after: IntentSnapshot | null;
  confidence?: Record<string, { value: unknown; score: number; basis: string }> | null;
  changed: { field: string; from: unknown; to: unknown }[];
}
export interface ClarificationLoop {
  status: "clear" | "asking" | "human_review";
  rounds_used: number;
  max_rounds: number;
  clear_at: number;
  confidence: Record<string, { value: unknown; score: number; basis: string }>;
  open_fields: string[];
  asked_by: string;
  phrased_by: string | null;
  stopped_because: string | null;
  rounds: LoopRound[];
}
export interface Answer {
  field: string;
  question: string;
  answer: string;
}
export interface PipelineStage {
  stage: "Intent" | "Evidence" | "Decision" | "Spec" | "Gates";
  role?: "agentic" | "deterministic" | "state";
  status: "ok" | "needs_input" | "skipped" | "pass" | "fail";
  summary: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}
export interface GateResult {
  passed: boolean;
  gates: { gate: string; passed: boolean; detail: string }[];
}
export interface Owner {
  owner_id: string;
  owner_name: string;
  role: string;
  scope: string;
}
export interface OwnerAssignment {
  type: "assign_owner";
  target: string;
  owner_id: string;
}
export interface GateSnapshot {
  owner?: string | null;
  as_of?: string;
  passing?: number;
  total?: number;
  failing?: string[];
  reason?: string | null;
  passed: boolean | null;
  gates: GateResult["gates"];
}
export interface RemediationPayload {
  request_id?: string;
  intent?: IntentSnapshot;
  remediations: OwnerAssignment[];
  owner?: string;
  review_by?: string;
  as_of?: string;
}
export interface RemediationResult {
  applied: "simulated";
  estate_snapshot: string;
  request_id: string | null;
  intent_source: string;
  as_of: string;
  decision: { action: Action; target: string | Asset | null; build_on: string | null };
  remediations: (OwnerAssignment & {
    target_table: string;
    owner_name: string;
    from_owner_id: string | null;
    from_status: string | null;
    citations: string[];
  })[];
  before: { owner: string | null; gates: GateSnapshot };
  after: { owner: string | null; gates: GateSnapshot };
  diff: {
    gate: string;
    before: boolean;
    after: boolean;
    detail_before: string;
    detail_after: string;
  }[];
  fixed: string[];
  still_failing: string[];
  passed_before: boolean | null;
  passed_after: boolean | null;
}
export interface OwnershipBottleneck extends Owner {
  status: string;
  specs_blocked: number;
  requests_blocked: string[];
  semantic_models: string[];
  assets_owned: number;
  fix: string;
  citations: string[];
  citations_total: number;
}
export interface RecordedGates extends Partial<GateSnapshot> {
  before_remediation?: GateSnapshot | null;
  at_approval?: GateSnapshot | null;
  as_of?: string;
}
export interface DecisionRecord {
  estate_snapshot: string;
  request_text: string;
  approver: string;
  owner: string;
  review_by: string;
  decision: string;
  rounds: LoopRound[];
  intent: IntentSnapshot;
  recommendation: {
    action: Action;
    target: string | Asset | null;
    build_on: string | null;
    citations?: number;
    client_action?: Action | null;
    client_target?: string | null;
    matches_client?: boolean;
  };
  gates: RecordedGates | null;
  remediation: RemediationResult | null;
  note?: string;
}
export interface DashboardSpec {
  title: string;
  purpose: string;
  products: string[];
  market: string;
  kpis: string[];
  semantic_model: string;
  source_action: "new_build" | "extend";
  governance: string[];
  target?: string | null;
  owner?: string | null;
  review_date?: string | null;
  measures?: { kpi_id: string; name: string; source: string }[];
  evidence?: Record<string, Evidence[]>;
}
export interface RadarAsset {
  id: string;
  name: string;
  views_3m: number;
  endorsement: string;
  status: string;
  reason: string;
}
export interface Radar {
  ownership_bottlenecks?: OwnershipBottleneck[];
  totals: {
    assets: number;
    kpis: number;
    kpi_status: Record<string, number>;
    ownerless: number;
    high_reach_uncertified: number;
    dead_or_unused: number;
  };
  kpi_conflicts: { metric: string; variants: { id: string; name: string; status: string }[] }[];
  ownerless_assets: RadarAsset[];
  high_reach_uncertified: RadarAsset[];
  dead_assets: RadarAsset[];
}
export interface ApprovePayload {
  intent?: IntentSnapshot;
  rounds?: LoopRound[];
  remediations?: OwnerAssignment[];
  request_id: string;
  decision: "approve" | "reject";
  approver: string;
  owner: string;
  review_by: string;
  answers?: Answer[];
  // Optional context so GET /log can show what was decided. The API stores the body as sent.
  text?: string;
  action?: Action;
  target?: string;
}
// One row of GET /log: the approve body plus what the API adds.
export interface LogRecord extends ApprovePayload {
  record?: DecisionRecord;
  registered_id: string;
  time: string;
  mode?: "demo";
}
export type WorkStatus =
  "clarifying" | "awaiting_approval" | "human_review" | "approved" | "rejected";
export interface WorkItemRow {
  model_id?: string | null;
  request_id: string;
  text: string;
  status: WorkStatus;
  action: Action;
  target: string | null;
  target_name: string | null;
  owner: string | null;
  created: string;
  updated: string;
  open_questions: number;
  gates_passed: boolean | null;
  origin: "user" | "sample";
  local_only?: boolean | undefined;
}
export interface WorkDecision {
  registered_id: string;
  decision: "approve" | "reject";
  approver: string;
  owner: string;
  review_by: string;
  time: string;
  gates_passed: boolean | null;
  estate_snapshot: string;
}
export interface WorkItem {
  request_id: string;
  text: string;
  status: WorkStatus;
  created: string;
  updated: string;
  origin: "user" | "sample";
  requester: string | null;
  result: RecommendResult;
  rounds: LoopRound[];
  remediation: RemediationResult | null;
  decision: WorkDecision | null;
  activity: {
    time: string;
    actor: string;
    event: "seeded" | "created" | "rechecked" | "remediation_simulated" | "approved" | "rejected";
    detail: string;
  }[];
  local_only?: boolean | undefined;
}
export interface RequestFilters {
  status?: string | undefined;
  q?: string | undefined;
}
export const getApiBaseUrl = () => API ?? "";
export const MAX_AUDIO_BYTES = 1_000_000;
export function voiceErrorMessage(code: string) {
  const messages: Record<string, string> = {
    empty_audio: "No audio was recorded",
    too_large: "The recording is too large",
    unsupported_type: "This recording format is not supported",
    no_speech: "No speech was detected",
    rate_limited: "Voice input is busy",
    not_configured: "Voice input is not available right now",
    permission_missing: "Voice input is not available right now",
    provider_failed: "Voice input could not be processed",
    provider_timeout: "Voice input took too long",
    microphone_denied: "Microphone permission was denied",
    microphone_failed: "The microphone could not start",
  };
  return `${messages[code] ?? messages["provider_failed"]}, please type instead`;
}
export interface Transcript { text: string; language: string }
export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<Transcript> {
  if (!API || demo) throw new Error(voiceErrorMessage("not_configured"));
  if (!blob.size) throw new Error(voiceErrorMessage("empty_audio"));
  if (blob.size > MAX_AUDIO_BYTES) throw new Error(voiceErrorMessage("too_large"));
  if (!/^audio\/(webm|ogg|mp4)(;|$)/i.test(blob.type)) throw new Error(voiceErrorMessage("unsupported_type"));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
  try {
    const response = await fetch(`${API}/transcribe`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(voiceErrorMessage(typeof body?.code === "string" ? body.code : "provider_failed"));
    if (typeof body?.text !== "string" || !body.text.trim() || typeof body?.language !== "string") throw new Error(voiceErrorMessage("no_speech"));
    return { text: body.text, language: body.language };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (timedOut) throw new Error(voiceErrorMessage("provider_timeout"));
    if (error instanceof Error && error.message.endsWith("please type instead")) throw error;
    throw new Error(voiceErrorMessage("provider_failed"));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export const ACCESS_CODE_KEY = "reuse-gate-access-code";
export function getAccessCode(): string {
  try {
    return sessionStorage.getItem(ACCESS_CODE_KEY) ?? "";
  } catch {
    return "";
  }
}
export function saveAccessCode(code: string) {
  sessionStorage.setItem(ACCESS_CODE_KEY, code);
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function writeHeaders() {
  const code = getAccessCode();
  return { "Content-Type": "application/json", ...(code ? { "X-Access-Code": code } : {}) };
}
export const getRequests = (filters: RequestFilters = {}) => {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.q) query.set("q", filters.q);
  return call<WorkItemRow[]>(
    `/requests${query.size ? `?${query}` : ""}`,
    undefined,
    () =>
      localItems()
        .map(itemRow)
        .filter(
          (row) =>
            (!filters.status || row.status === filters.status) &&
            (!filters.q ||
              `${row.text} ${row.request_id} ${row.target_name ?? ""}`
                .toLowerCase()
                .includes(filters.q.toLowerCase())),
        )
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .slice(0, 200),
    true,
  );
};
export const getRequest = (id: string): Promise<WorkItem> => {
  if (id.startsWith("LOCAL-")) {
    setDemo();
    const item = localItems().find((candidate) => candidate.request_id === id);
    return item ? Promise.resolve(item) : Promise.reject(new Error("Local draft not found."));
  }
  return call<WorkItem>(
    `/requests/${encodeURIComponent(id)}`,
    undefined,
    () => {
      const item = localItems().find((candidate) => candidate.request_id === id);
      if (!item)
        throw new Error("Request not found in offline data. Connect to the API or open a sample.");
      return item;
    },
    true,
  );
};

export interface Health {
  status: "live" | "down" | "demo";
  assets?: number | undefined;
}

const data = mock as unknown as { requests: RecommendResult[]; radar: Radar; owners: Owner[] };
export const exampleRequests = data.requests.map((r) => r.text);

const API = (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "");
let demo = !API;
const listeners = new Set<(d: boolean) => void>();
export const isDemo = () => demo;
export const onDemoChange = (fn: (d: boolean) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const setMode = (next: boolean) => {
  if (demo !== next) {
    demo = next;
    listeners.forEach((listener) => listener(next));
  }
};
const setDemo = () => setMode(true);

async function call<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: () => T,
  workResource = false,
): Promise<T> {
  if (API) {
    let rejected = "";
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      if (res.status >= 400 && res.status < 500)
        rejected = `The API rejected the request (${res.status}).`;
      else if (!res.ok) throw new Error(String(res.status));
      else {
        const body = (await res.json()) as T;
        if (workResource) setMode(false);
        return body;
      }
    } catch {
      setDemo();
    }
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
  if (!hit)
    throw new Error(
      "No demo example matches this request. Choose an example or connect the live API.",
    );
  return { ...hit, text };
}

export const recommend = (text: string, answers: Answer[] = [], rounds?: LoopRound[]) =>
  call<RecommendResult>(
    "/recommend",
    { method: "POST", body: JSON.stringify({ text, answers, ...(rounds ? { rounds } : {}) }) },
    () => mockRecommend(text),
  );

// Audio exists only on the live API. A failure here is not a reason to switch the app to demo data.
export const canSpeak = () => Boolean(API) && !demo;
export async function speak(text: string): Promise<Blob> {
  const res = await fetch(`${API}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}

export const getRadar = () => call<Radar>("/radar", undefined, () => data.radar);

export async function approve(
  p: ApprovePayload,
): Promise<{ ok: true; registered_id: string; mode?: "demo" }> {
  if (!API || demo)
    throw new Error("Approval needs the live API. Offline decisions are not recorded.");
  try {
    const res = await fetch(`${API}/approve`, {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify(p),
    });
    if (res.status === 401)
      throw new ApiError("Access code required. Enter it in Admin settings.", 401);
    if (res.status === 409)
      throw new ApiError("This request already has a decision. Refresh the item.", 409);
    if (!res.ok) throw new Error("Approval rejected");
    const body = await res.json();
    if (body?.ok !== true || typeof body.registered_id !== "string" || !body.registered_id) {
      throw new Error("Approval was not confirmed");
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Could not register the decision. Check the API connection and try again.");
  }
}

export const getLog = () => call<LogRecord[]>("/log", undefined, () => []);

// Health is reported as it is: a failed check never switches the app to demo data.
export async function getHealth(): Promise<Health> {
  if (!API) return { status: "demo" };
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { status: "down" };
    const body = (await res.json()) as { ok?: boolean; assets?: number };
    return body.ok ? { status: "live", assets: body.assets } : { status: "down" };
  } catch {
    return { status: "down" };
  }
}

export const generateSpec = (result: RecommendResult, owner: string, reviewBy: string) =>
  call<{ spec: DashboardSpec; gates?: GateResult }>(
    "/spec",
    {
      method: "POST",
      body: JSON.stringify({
        intent: result.intent,
        recommendation: result.recommendation,
        owner,
        review_by: reviewBy,
      }),
    },
    () => {
      if (
        result.recommendation.action !== "new_build" &&
        result.recommendation.action !== "extend"
      ) {
        throw new Error("DashboardSpec is only available for build decisions");
      }
      return {
        spec: {
          title: result.recommendation.target
            ? `Extended ${result.recommendation.target.name}`
            : `${result.intent.products.join(", ")} dashboard`,
          purpose: `Governed view of ${result.intent.kpis.join(", ")} for ${result.intent.products.join(", ")} in ${result.intent.market}.`,
          products: result.intent.products,
          market: result.intent.market,
          kpis: result.intent.kpis,
          semantic_model: result.recommendation.build_on ?? "",
          source_action: result.recommendation.action,
          governance: [
            "Use canonical KPI definitions only",
            "Register an owner and review date before release",
            "Keep evidence and approval in the decision log",
          ],
        },
      };
    },
  );

export const getOwners = () => call<Owner[]>("/owners", undefined, () => data.owners);
export interface EvaluationMetric {
  id: string;
  name: string;
  value: number | string | null;
  unit: string;
  n: number;
  method: string;
  basis: string;
  caveat: string;
}
export interface Evaluation {
  generated_at: string;
  estate_snapshot: string;
  groups: { group: string; metrics: EvaluationMetric[] }[];
}
export const getEvaluation = () =>
  call<Evaluation>("/evaluation", undefined, () => mock.evaluation, true);
export const canRemediate = () => Boolean(API) && !demo;

// A simulation must come from the live API. Never fabricate a remediation fallback.
export async function remediate(payload: RemediationPayload): Promise<RemediationResult> {
  if (!canRemediate()) throw new Error("This simulation needs the live API.");
  let response: Response;
  try {
    response = await fetch(`${API}/remediate`, {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not recheck gates. Check the API connection and try again.");
  }
  const body = await response.json().catch(() => null);
  if (response.status === 401)
    throw new ApiError("Access code required. Enter it in Admin settings.", 401);
  if (response.status === 409) throw new ApiError("This request is closed. Refresh the item.", 409);
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "Could not recheck gates. The simulation needs the live API with /remediate available.",
    );
  }
  if (
    body?.applied !== "simulated" ||
    !Array.isArray(body.before?.gates?.gates) ||
    !Array.isArray(body.after?.gates?.gates)
  ) {
    throw new Error("The API did not confirm a simulated gate check. Try again.");
  }
  return body as RemediationResult;
}

export interface SaveRequestPayload {
  text?: string;
  answers?: Answer[];
  rounds?: LoopRound[];
  request_id?: string;
  requester?: string;
}
export interface SaveRequestResponse {
  request_id: string;
  status: WorkStatus;
  result: RecommendResult;
}
export async function saveRequest(payload: SaveRequestPayload): Promise<SaveRequestResponse> {
  if (API) {
    let response: Response | null = null;
    try {
      response = await fetch(`${API}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...(payload.request_id?.startsWith("LOCAL-") ? { request_id: undefined } : {}),
        }),
      });
    } catch {
      setDemo();
    }
    if (response) {
      if (response.status === 409)
        throw new ApiError("This request already has a decision. Refresh the item.", 409);
      if (!response.ok)
        throw new ApiError(
          response.status === 404
            ? "Request not found on the server."
            : "The request could not be saved. Check the text and try again.",
          response.status,
        );
      const body = await response.json();
      if (
        typeof body?.request_id !== "string" ||
        !body.result ||
        typeof body.result.text !== "string"
      )
        throw new Error("The API did not return a saved request.");
      setMode(false);
      return body as SaveRequestResponse;
    }
  }
  const prior = localItems().find((item) => item.request_id === payload.request_id);
  const text = payload.text ?? prior?.text ?? "";
  if (!text.trim()) throw new Error("Describe the report you need before saving.");
  const id = prior?.local_only
    ? prior.request_id
    : `LOCAL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sample =
    (prior?.text === text ? prior : undefined) ??
    localItems().find((item) => item.text.toLowerCase() === text.toLowerCase());
  const now = new Date().toISOString();
  const result: RecommendResult = sample
    ? {
        ...sample.result,
        request_id: id,
        text,
        answers: payload.answers ?? sample.result.answers ?? [],
      }
    : {
        request_id: id,
        text,
        intent: {
          products: [],
          market: "",
          kpis: [],
          kind: "new_report",
          clarifications: [],
          questions: [],
        },
        recommendation: {
          action: "human_review",
          target: null,
          build_on: null,
          retire: [],
          repair: [],
          rationale: [
            "This local draft has not been analysed. Connect to the live API to check existing reports.",
          ],
          evidence: [],
        },
        answers: payload.answers ?? [],
      };
  const item: WorkItem = {
    request_id: id,
    text,
    status: sample?.status ?? "human_review",
    created: prior?.created ?? now,
    updated: now,
    origin: "user",
    requester: payload.requester ?? prior?.requester ?? null,
    result,
    rounds: payload.rounds ?? prior?.rounds ?? [],
    remediation: null,
    decision: null,
    activity: [
      ...(prior?.activity ?? []),
      {
        time: now,
        actor: payload.requester ?? "Local user",
        event: prior ? "rechecked" : "created",
        detail: "Draft saved locally only. No live analysis or decision was performed.",
      },
    ],
    local_only: true,
  };
  saveLocalItem(item);
  return { request_id: id, status: item.status, result };
}

export async function getProviderInfo(): Promise<
  Partial<Record<"intent" | "explanation" | "speech" | "transcription", string>>
> {
  if (!API) return {};
  try {
    const response = await fetch(`${API}/health`);
    if (!response.ok) return {};
    const body = (await response.json()) as { providers?: Record<string, unknown> };
    const allowed = new Set([
      "ready",
      "configured",
      "unavailable",
      "not_configured",
      "off",
      "error",
    ]);
    return Object.fromEntries(
      ["intent", "explanation", "speech", "transcription"].flatMap((name) => {
        const status = body.providers?.[name];
        return typeof status === "string" && allowed.has(status) ? [[name, status]] : [];
      }),
    );
  } catch {
    return {};
  }
}

// Model associations are not part of list rows. Confirm them from item details.
export async function requestsForView(
  filters: RequestFilters,
  model?: string,
): Promise<WorkItemRow[]> {
  const rows = await getRequests(filters);
  if (!model?.startsWith("SM-")) return rows;
  const result = [...rows];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        const row = rows[index]!;
        if (row.model_id !== undefined) continue;
        const detail = await getRequest(row.request_id);
        result[index] = { ...row, model_id: detail.result.recommendation.build_on };
      }
    }),
  );
  return result;
}
export async function findModelRequest(
  rows: WorkItemRow[],
  model: string,
): Promise<WorkItemRow | null> {
  const open = rows.filter((row) => row.status !== "approved" && row.status !== "rejected");
  for (const row of open) if (row.model_id === model) return row;
  for (const row of open.filter(
    (candidate) => candidate.action === "new_build" || candidate.action === "extend",
  )) {
    const detail = await getRequest(row.request_id);
    if (detail.result.recommendation.build_on === model) return row;
  }
  return null;
}
