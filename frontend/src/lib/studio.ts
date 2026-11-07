import { apiGet, apiPost } from "./api";

// The role workspaces: analyst dashboards, executive report, operator wall, developer config changes, admin workflows.

export interface Field {
  id: string;
  label: string;
  unit?: string;
}
export interface Dataset {
  id: string;
  label: string;
  source: string;
  dimensions: Field[];
  measures: Field[];
}
export type Chart = "bar" | "line" | "table" | "number";
export interface Tile {
  dataset: string;
  measure: string;
  dimension: string | null;
  split?: string | null;
  filters?: Record<string, string[]> | null;
  chart: Chart;
  width: 1 | 2 | 3;
  title: string;
}
export interface TileData {
  dataset: string;
  source: string;
  dimension: string | null;
  split: string | null;
  measure: string;
  measure_label: string;
  unit: string;
  rows: Record<string, string | number | null>[];
  truncated: boolean;
}
export interface Dashboard {
  id?: string;
  title: string;
  description?: string;
  tiles: Tile[];
  shared: boolean;
  request_id?: string | null;
  owner?: string;
  created?: string;
  updated?: string;
  updated_by?: string;
}

export const getCatalog = () => apiGet<Dataset[]>("/explore/catalog");
export const queryTile = (tile: Tile) => apiPost<TileData>("/explore/query", { tile });
export const previewFromRequest = (requestId: string) =>
  apiPost<{ request_id: string; title: string; tiles: Tile[]; kpis: string[] }>(
    "/explore/preview",
    {
      request_id: requestId,
    },
  );
export const getDashboards = () => apiGet<Dashboard[]>("/dashboards");
export const saveDashboard = (board: Dashboard) => apiPost<Dashboard>("/dashboards", board);

export interface ReportSection {
  title: string;
  text: string;
  source: string;
}
export interface ExecutiveReport {
  title: string;
  generated_at: string;
  headline: string;
  sections: ReportSection[];
  actions: string[];
  figures: Record<string, number | null>;
  sales_by_product: { product: string; net_sales: number; forecast: number }[];
  data_note: string;
  text: string;
}
export const getReport = () => apiGet<ExecutiveReport>("/report");
export const emailReport = () => apiPost<OutboxRow>("/report/email", {});

export interface Operations {
  generated_at: string;
  usage_month: string;
  failed_refresh: { id: string; name: string; owner: string; owner_active: boolean }[];
  query_errors: { id: string; name: string; owner: string; errors: number; load_ms: number }[];
  supply_lowest_otif: {
    product: string;
    market: string;
    risk: string;
    otif: number;
    inventory_weeks: number;
  }[];
  supply_risk: Record<string, number>;
  open_high_signals: Record<string, number>;
  queue: { awaiting_approval: number; human_review: number; clarifying: number };
  sources: string[];
}
export const getOperations = () => apiGet<Operations>("/operations");

export interface Tunable {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  type: "int" | "float";
}
export interface BatchSummary {
  total: number;
  avoided: number;
  actions: Record<string, number>;
  clarifications: number;
}
export interface ConfigChange {
  id: string;
  status: "proposed" | "approved" | "rejected";
  settings: Record<string, number>;
  kpi_synonyms: { phrase: string; kpi: string }[];
  market_aliases: Record<string, string>;
  reason: string;
  impact: {
    before: BatchSummary;
    after: BatchSummary;
    changed: {
      request_id: string;
      before: string;
      after: string;
      before_target: string | null;
      after_target: string | null;
    }[];
    changed_count: number;
  };
  proposed_by: string;
  created: string;
  decided_by: string | null;
  decided: string | null;
  comment: string | null;
  patch: Record<string, unknown> | null;
}
export interface ConfigState {
  tunables: Tunable[];
  kpis: string[];
  kpi_synonyms: string[];
  markets: string[];
  market_aliases: Record<string, string>;
  changes: ConfigChange[];
}
export interface Proposal {
  settings: Record<string, number>;
  kpi_synonyms: { phrase: string; kpi: string }[];
  market_aliases: Record<string, string>;
  reason: string;
}
export const getConfig = () => apiGet<ConfigState>("/config");
export const proposeChange = (proposal: Proposal) =>
  apiPost<ConfigChange>("/config/changes", proposal);
export const decideChange = (id: string, decision: "approve" | "reject", comment: string) =>
  apiPost<ConfigChange>(`/config/changes/${encodeURIComponent(id)}`, { decision, comment });

export interface OutboxRow {
  id: string;
  event: string;
  role: string;
  to_count: number;
  subject: string;
  actor: string | null;
  link: string | null;
  time: string;
  status: "queued" | "sent" | "failed" | "not_configured" | "no_recipient";
  detail?: string;
}
export interface Notifications {
  configured: boolean;
  webhook: boolean;
  secret: boolean;
  recipients: Record<string, number>;
  outbox: OutboxRow[];
}
export const getNotifications = () => apiGet<Notifications>("/notifications");
export const sendTestEmail = (role: string) => apiPost<OutboxRow>("/notifications/test", { role });

export function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n");
}
