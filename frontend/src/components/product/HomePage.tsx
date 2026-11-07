import { Link } from "@tanstack/react-router";
import { getRequests } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { RequestList } from "./RequestList";
import { ListState, PageHeading, STATUS } from "./shared";
import { AdminSettings } from "./AdminSettings";
import { ImpactLine } from "./Impact";
import { NewRequestForm } from "./RequestPages";
export function HomePage() {
  const [role] = useLens();
  if (role === "admin") return <AdminSettings />;
  return <WorkHome role={role === "approver" ? "approver" : "requester"} />;
}
function WorkHome({ role }: { role: "requester" | "approver" }) {
  const resource = useResource(() => getRequests(), role);
  const rows = (resource.data ?? []).filter(
    (row) =>
      role === "requester" || row.status === "awaiting_approval" || row.status === "human_review",
  );
  return (
    <>
      {role === "requester" ? (
        <>
          <PageHeading
            title="Before you build a dashboard, check what already exists"
            description="Describe the report you need. Reuse Gate checks existing reports, KPI definitions and owners, recommends reuse, repair, extension or a new build with cited rows, and a person approves the decision."
          />
          <ImpactLine />
          <div className="mt-6">
            <NewRequestForm examples />
          </div>
          <h2 className="section-title">Your requests</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Sample items are clearly marked. This preview has no signed-in identity, so it shows
            accessible requests, up to the 200 most recent items.
          </p>
        </>
      ) : (
        <PageHeading
          title="Decisions that need you"
          description="Review the requests waiting for a decision, with blockers and readiness visible before you open them."
          action={
            <Link className="primary-action" to="/approvals">
              Open approval queue
            </Link>
          }
        />
      )}
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={!rows.length}
        retry={resource.reload}
      />
      {!resource.loading && !resource.error && role === "requester"
        ? Object.entries(STATUS).map(([status, meta]) => {
            const group = rows.filter((row) => row.status === status);
            return (
              group.length > 0 && (
                <section className="mb-8" key={status}>
                  <h2 className="section-title">
                    {meta.label} <span className="text-muted-foreground">{group.length}</span>
                  </h2>
                  <RequestList rows={group} />
                </section>
              )
            );
          })
        : !resource.loading &&
          !resource.error &&
          rows.length > 0 && (
            <RequestList
              rows={[...rows].sort(
                (a, b) => Number(a.gates_passed === true) - Number(b.gates_passed === true),
              )}
            />
          )}
    </>
  );
}
