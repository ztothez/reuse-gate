import type { ReactNode } from "react";
import {
  CheckCircle2,
  Wrench,
  PlusSquare,
  ArrowRightLeft,
  Recycle,
  Hammer,
  UserSearch,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { Action } from "@/lib/api";

export const ACTIONS: Record<Action, { label: string; icon: LucideIcon; tone: string }> = {
  reuse: { label: "Reuse existing report", icon: CheckCircle2, tone: "tone-green" },
  repair_and_reuse: { label: "Repair and reuse", icon: Wrench, tone: "tone-teal" },
  extend: { label: "Extend an existing report", icon: PlusSquare, tone: "tone-blue" },
  migrate: { label: "Migrate to Power BI", icon: ArrowRightLeft, tone: "tone-indigo" },
  retire_and_reuse: { label: "Reuse and retire duplicates", icon: Recycle, tone: "tone-teal" },
  new_build: { label: "New build on a governed model", icon: Hammer, tone: "tone-amber" },
  human_review: { label: "Needs human review", icon: UserSearch, tone: "tone-gray" },
  retire: { label: "Retire", icon: Trash2, tone: "tone-red" },
};

export function Panel({
  title,
  children,
  caption,
}: {
  title: string;
  children: ReactNode;
  caption?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-panel">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {caption && <p className="mt-1 text-sm text-muted-foreground">{caption}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Chip({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground ${mono ? "font-mono" : ""}`}
    >
      {children}
    </span>
  );
}

export function Endorsement({ value }: { value?: string | undefined }) {
  const v = value ?? "none";
  const cls = v === "certified" ? "tone-green" : v === "promoted" ? "tone-blue" : "tone-gray";
  return (
    <span className={`${cls} inline-flex rounded-full border px-2 py-0.5 text-xs font-medium`}>
      {v}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="tone-red rounded-md border p-4 text-sm">
      {children}
    </p>
  );
}
