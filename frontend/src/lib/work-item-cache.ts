import { z } from "zod";
import mock from "@/data/mock_api.json";
import type { WorkItem, WorkItemRow } from "./api";

export const WORK_CACHE_KEY = "reuse-gate-work-items-v1";
const strings = z.array(z.string());
const question = z.object({ text: z.string(), field: z.string(), phrased: z.string().optional() });
const asset = z.object({ id: z.string(), name: z.string() }).passthrough();
const result = z.object({
  request_id: z.string(), text: z.string(),
  intent: z.object({ products: strings, market: z.string(), kpis: strings, kind: z.string(), clarifications: strings, questions: z.array(question).optional() }),
  recommendation: z.object({ action: z.enum(["reuse", "repair_and_reuse", "extend", "migrate", "retire_and_reuse", "new_build", "human_review", "retire"]), target: asset.nullable(), build_on: z.string().nullable(), retire: z.array(asset), repair: z.array(z.union([z.string(), asset])), rationale: strings, evidence: z.array(z.object({ table: z.string(), id: z.string(), note: z.string() })) }),
  answers: z.array(z.object({ field: z.string(), question: z.string(), answer: z.string() })).optional(),
  pipeline: z.array(z.object({ stage: z.enum(["Intent", "Evidence", "Decision", "Spec", "Gates"]), status: z.string(), summary: z.string(), input: z.record(z.string(), z.unknown()), output: z.record(z.string(), z.unknown()) })).optional(),
  loop: z.object({ status: z.enum(["asking", "clear", "human_review"]), rounds: z.array(z.object({ round: z.number(), questions: z.array(question), answers: z.array(z.object({ field: z.string(), question: z.string(), answer: z.string() })), intent: z.unknown(), intent_after: z.unknown(), changed: z.array(z.unknown()) })), max_rounds: z.number(), rounds_used: z.number() }).passthrough().optional(),
  ai: z.object({ explanation: strings.optional(), speech: z.string().optional() }).passthrough().optional(),
}).passthrough();
export const itemSchema = z.object({ request_id: z.string(), text: z.string(), status: z.enum(["clarifying", "awaiting_approval", "human_review", "approved", "rejected"]), created: z.string(), updated: z.string(), origin: z.enum(["sample", "user"]), requester: z.string().nullable(), result, rounds: z.array(z.unknown()), remediation: z.null(), decision: z.null(), activity: z.array(z.object({ time: z.string(), actor: z.string(), event: z.string(), detail: z.string() })), local_only: z.boolean().optional() });
let notice: string | null = null;
const samples = () => Object.values(mock.work_items.detail) as unknown as WorkItem[];
export function storageNotice() { return notice; }
export function resetWorkCache() { try { localStorage.setItem(WORK_CACHE_KEY, "[]"); } catch { /* in-memory samples remain available */ } notice = null; }
export function localItems(): WorkItem[] {
  try {
    const raw = localStorage.getItem(WORK_CACHE_KEY);
    if (!raw) return samples();
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored) || !stored.every((item) => itemSchema.safeParse(item).success)) throw new Error("invalid");
    const combined = new Map(samples().map((item) => [item.request_id, item]));
    (stored as WorkItem[]).forEach((item) => combined.set(item.request_id, item));
    return [...combined.values()];
  } catch { notice = "Invalid saved requests were ignored."; return samples(); }
}
export function saveLocalItem(item: WorkItem) {
  const items = localItems().filter((candidate) => candidate.local_only && candidate.request_id !== item.request_id);
  try { localStorage.setItem(WORK_CACHE_KEY, JSON.stringify([...items, item])); }
  catch { throw new Error("Local storage is unavailable. This request could not be saved locally."); }
}
export function itemRow(item: WorkItem): WorkItemRow {
  const spec = item.result.pipeline?.find((stage) => stage.stage === "Spec")?.output;
  const gates = item.result.pipeline?.find((stage) => stage.stage === "Gates")?.output;
  return { request_id: item.request_id, text: item.text, status: item.status, action: item.result.recommendation.action, target: item.result.recommendation.target?.id ?? item.result.recommendation.build_on, target_name: item.result.recommendation.target?.name ?? null, owner: item.decision?.owner ?? (typeof spec?.["owner"] === "string" ? spec["owner"] : null), created: item.created, updated: item.updated, origin: item.origin, open_questions: item.result.intent.questions?.length ?? item.result.intent.clarifications.length, gates_passed: item.remediation?.after.gates.passed ?? (typeof gates?.["passed"] === "boolean" ? gates["passed"] : null), local_only: item.local_only };
}
