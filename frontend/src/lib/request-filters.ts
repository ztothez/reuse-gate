import type { WorkItemRow } from "./api";
export type TableFilters = Partial<
  Record<"q" | "status" | "owner" | "origin" | "from" | "to" | "sort" | "target" | "action", string>
>;
export function filterRequests(rows: WorkItemRow[], filters: TableFilters) {
  const matching = rows.filter(
    (row) =>
      (!filters.q ||
        `${row.text} ${row.request_id} ${row.target_name ?? ""}`
          .toLowerCase()
          .includes(filters.q.toLowerCase())) &&
      (!filters.status || row.status === filters.status) &&
      (!filters.owner || (row.owner ?? "unassigned") === filters.owner) &&
      (!filters.origin || row.origin === filters.origin) &&
      (!filters.from || row.created.slice(0, 10) >= filters.from) &&
      (!filters.to || row.created.slice(0, 10) <= filters.to) &&
      (!filters.target || row.target === filters.target || row.model_id === filters.target) &&
      (!filters.action ||
        (filters.action === "existing"
          ? row.action !== "new_build" && row.action !== "human_review"
          : row.action === filters.action)),
  );
  return matching.sort((a, b) =>
    filters.sort === "created_asc"
      ? a.created.localeCompare(b.created)
      : filters.sort === "created_desc"
        ? b.created.localeCompare(a.created)
        : filters.sort === "owner"
          ? (a.owner ?? "").localeCompare(b.owner ?? "")
          : filters.sort === "origin"
            ? a.origin.localeCompare(b.origin)
            : filters.sort === "status"
              ? a.status.localeCompare(b.status)
              : b.updated.localeCompare(a.updated),
  );
}
