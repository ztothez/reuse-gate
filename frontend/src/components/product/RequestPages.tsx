import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { getRequests, requestsForView, saveRequest, type WorkItemRow } from "@/lib/api";
import { itemsChanged, useResource } from "@/lib/use-resource";
import { filterRequests } from "@/lib/request-filters";
import { RequestList } from "./RequestList";
import { ListState, PageHeading, STATUS } from "./shared";
import { ReviewPane } from "./ReviewPane";
import { VoiceInput } from "./VoiceInput";
export { RequestDetailPage } from "./RequestDetailPage";
export function NewRequestForm() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [requester, setRequester] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="panel mb-8 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        setError(null);
        void saveRequest({ text, ...(requester.trim() ? { requester: requester.trim() } : {}) })
          .then((saved) => {
            itemsChanged();
            return navigate({
              to: "/requests/$requestId",
              params: { requestId: saved.request_id },
            });
          })
          .catch((failure: unknown) =>
            setError(failure instanceof Error ? failure.message : "Could not create the request."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h2 className="section-title">New request</h2>
      <label className="block text-sm font-semibold" htmlFor="new-request-text">
        What report do you need?
      </label>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)]">
        <textarea
          id="new-request-text"
          className="control min-h-32 w-full text-base"
          rows={4}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          required
          placeholder="Describe the products, market and measures you need"
        />
        <VoiceInput onUse={setText} disabled={busy} />
      </div>
      <label className="block text-sm font-semibold" htmlFor="new-requester">
        Your name (optional)
      </label>
      <input
        id="new-requester"
        className="control w-full"
        value={requester}
        disabled={busy}
        onChange={(event) => setRequester(event.target.value)}
      />
      {error && (
        <p role="alert" className="tone-red rounded p-4">
          {error}
        </p>
      )}
      <button className="primary-action" disabled={busy || !text.trim()}>
        {busy ? "Creating request..." : "Create request"}
      </button>
    </form>
  );
}
export function RequestsPage() {
  const search = useSearch({ from: "/requests" });
  const navigate = useNavigate();
  const resource = useResource(
    () => requestsForView({ q: search.q, status: search.status }, search.target),
    JSON.stringify({ q: search.q, status: search.status, target: search.target }),
  );
  const rows = filterRequests(resource.data ?? [], search);
  const owners = [...new Set((resource.data ?? []).map((row) => row.owner ?? "unassigned"))].sort();
  function filter(key: string, value: string) {
    void navigate({ to: "/requests", search: { ...search, [key]: value } });
  }
  return (
    <>
      <PageHeading
        title="Requests"
        description="Saved requests with a status, an owner and a link you can return to."
        action={
          <Link className="primary-action" to="/requests" search={{ ...search, create: "1" }}>
            New request
          </Link>
        }
      />
      {search.create === "1" && <NewRequestForm />}
      <div className="panel mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          Status
          <select
            aria-label="Status"
            className="control mt-2 w-full"
            value={search.status ?? ""}
            onChange={(event) => filter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([status, meta]) => (
              <option key={status} value={status}>
                {meta.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Owner
          <select
            aria-label="Owner"
            className="control mt-2 w-full"
            value={search.owner ?? ""}
            onChange={(event) => filter("owner", event.target.value)}
          >
            <option value="">All owners</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner === "unassigned" ? "Unassigned" : owner}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Origin
          <select
            aria-label="Origin"
            className="control mt-2 w-full"
            value={search.origin ?? ""}
            onChange={(event) => filter("origin", event.target.value)}
          >
            <option value="">All origins</option>
            <option value="user">User requests</option>
            <option value="sample">Samples</option>
          </select>
        </label>
        <label className="text-sm">
          Created from
          <input
            aria-label="Created from"
            type="date"
            className="control mt-2 w-full"
            value={search.from ?? ""}
            onChange={(event) => filter("from", event.target.value)}
          />
        </label>
        <label className="text-sm">
          Created through
          <input
            aria-label="Created through"
            type="date"
            className="control mt-2 w-full"
            value={search.to ?? ""}
            onChange={(event) => filter("to", event.target.value)}
          />
        </label>
        <label className="text-sm">
          Sort requests
          <select
            aria-label="Sort requests"
            className="control mt-2 w-full"
            value={search.sort ?? "updated_desc"}
            onChange={(event) => filter("sort", event.target.value)}
          >
            <option value="updated_desc">Recently updated</option>
            <option value="created_desc">Newest created</option>
            <option value="created_asc">Oldest created</option>
            <option value="status">Status</option>
            <option value="owner">Owner</option>
            <option value="origin">Origin</option>
          </select>
        </label>
      </div>
      <div aria-label="Active filters" className="mb-4 flex flex-wrap gap-2">
        {Object.entries(search)
          .filter(([key, value]) => value && !["sort", "create"].includes(key))
          .map(([key, value]) => (
            <button
              key={key}
              className="control break-all"
              onClick={() => filter(key, "")}
              aria-label={`Remove ${key} filter`}
            >
              {key}: {value} ×
            </button>
          ))}
      </div>
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={!rows.length}
        retry={resource.reload}
      />
      {!resource.loading && !resource.error && rows.length > 0 && <RequestList rows={rows} />}
      <p className="mt-4 text-xs text-muted-foreground">
        {rows.length} rows shown. The API returns up to 200 items, newest first. Use the status
        filter to focus on pending or completed requests. Date filters use the recorded creation
        day.
      </p>
    </>
  );
}
export function ApprovalsPage() {
  const search = useSearch({ from: "/approvals" });
  const [readyOnly, setReadyOnly] = useState(false);
  const resource = useResource(() => getRequests());
  const rows = (resource.data ?? [])
    .filter(
      (row) =>
        (row.status === "awaiting_approval" || row.status === "human_review") &&
        (!readyOnly || row.gates_passed === true || row.gates_passed === null),
    )
    .sort((a, b) => Number(a.gates_passed === true) - Number(b.gates_passed === true));
  const selected = search.id ?? rows[0]?.request_id;
  return (
    <>
      <PageHeading
        title="Approval queue"
        description="Start with blockers, then review the requests ready for your decision."
        action={
          <button className="primary-action" onClick={resource.reload}>
            Refresh queue
          </button>
        }
      />
      <label className="mb-6 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={readyOnly}
          onChange={(event) => setReadyOnly(event.target.checked)}
        />
        Show ready requests only
      </label>
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={!rows.length}
        retry={resource.reload}
      />
      <div className="grid min-w-0 gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          {rows.length > 0 && <RequestList rows={rows as WorkItemRow[]} review />}
        </div>
        {selected && (
          <div className="min-w-0">
            <ReviewPane id={selected} />
          </div>
        )}
      </div>
    </>
  );
}
