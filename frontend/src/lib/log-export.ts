import type { LogEntry } from "./decision-log";
export function decisionCsv(rows: LogEntry[]): string {
  const cell = (value: string) =>
    `"${(/^[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
  const values = [
    ["Time", "Request", "Action", "Target", "Decision", "Approver", "Owner", "Review by", "Origin"],
    ...rows.map((row) => [
      row.time,
      row.text,
      row.action ?? "",
      row.target,
      row.decision,
      row.approver,
      row.owner,
      row.review_by,
      row.mode === "demo" ? "demo" : "live",
    ]),
  ];
  return values.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function downloadDecisions(rows: LogEntry[], format: "csv" | "json") {
  const content = format === "csv" ? decisionCsv(rows) : JSON.stringify(rows, null, 2);
  const type = format === "csv" ? "text/csv;charset=utf-8" : "application/json";
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reuse-gate-decisions.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
