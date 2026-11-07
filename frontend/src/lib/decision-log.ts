import { useEffect, useState } from "react";
import type { Action } from "./api";

export interface LogEntry {
  id: string;
  time: string;
  text: string;
  action: Action;
  target: string;
  decision: "approve" | "reject";
  approver: string;
  owner: string;
  review_by: string;
}
const KEY = "reuse-gate-log";
let memory: LogEntry[] = [];
const subs = new Set<(l: LogEntry[]) => void>();

function read(): LogEntry[] {
  try {
    const v = localStorage.getItem(KEY);
    return v ? JSON.parse(v) : memory;
  } catch {
    return memory;
  }
}
export function addEntry(e: LogEntry) {
  const next = [e, ...read()];
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* memory fallback */
  }
  subs.forEach((s) => s(next));
}
export function useDecisionLog() {
  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(() => {
    setLog(read());
    subs.add(setLog);
    return () => {
      subs.delete(setLog);
    };
  }, []);
  return log;
}
export const newBuildsAvoided = (log: LogEntry[]) =>
  log.filter((e) => e.decision === "approve" && e.action !== "new_build").length;
