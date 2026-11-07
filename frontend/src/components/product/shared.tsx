import type { ReactNode } from "react";
import { CheckCircle2, CircleHelp, Clock3, MessageSquare, XCircle } from "lucide-react";
import type { WorkStatus } from "@/lib/api";
export const STATUS: Record<WorkStatus, { label: string; tone: string; icon: typeof Clock3 }> = {
  clarifying: { label: "Needs clarification", tone: "tone-amber", icon: MessageSquare },
  awaiting_approval: { label: "Awaiting approval", tone: "tone-blue", icon: Clock3 },
  human_review: { label: "Human review", tone: "tone-amber", icon: CircleHelp },
  approved: { label: "Approved", tone: "tone-green", icon: CheckCircle2 },
  rejected: { label: "Rejected", tone: "tone-gray", icon: XCircle },
};
export function StatusBadge({ status }: { status: WorkStatus }) { const meta = STATUS[status]; const Icon = meta.icon; return <span className={`${meta.tone} inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold`}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{meta.label}</span>; }
export function SampleTag() { return <span className="rounded border bg-muted px-2 py-1 text-xs text-muted-foreground">Sample</span>; }
export function PageHeading({ title, description, action, titleClassName }: { title: string; description: string; action?: ReactNode; titleClassName?: string }) { return <div className="mb-8 flex min-w-0 flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className={titleClassName ?? "text-3xl font-semibold tracking-tight sm:text-4xl"}>{title}</h1><p className="mt-2 max-w-3xl text-base text-muted-foreground">{description}</p></div>{action}</div>; }
export function ListState({ loading, error, empty, retry, emptyText }: { loading: boolean; error: string | null; empty: boolean; retry: () => void; emptyText?: string }) { if (loading) return <p role="status" className="panel">Loading...</p>; if (error) return <div role="alert" className="panel tone-red"><p>{error}</p><button className="control mt-4" onClick={retry}>Try again</button></div>; if (empty) return <p className="panel text-muted-foreground">{emptyText ?? "No items match this view. Try a different filter or create a request."}</p>; return null; }
export function localDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(); }
