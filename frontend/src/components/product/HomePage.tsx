import { Link } from "@tanstack/react-router";
import { getRequests } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { RequestList } from "./RequestList";
import { ListState, PageHeading, STATUS } from "./shared";
import { HealthIndicator } from "@/components/gate/AdminView";
export function HomePage() {
  const [role] = useLens(); const resource = useResource(() => getRequests());
  if (role === "executive") return <><PageHeading title="Build less. Reuse more." description="See what demand and ownership mean for the reports your teams build." action={<Link className="primary-action" to="/overview">Open overview</Link>} /><p className="panel">Demand, decisions and ownership are brought together in the Executive overview.</p></>;
  if (role === "admin") return <><PageHeading title="System health and ownership" description="Check API availability, access settings and the ownership behind governance blockers." action={<Link className="primary-action" to="/admin">Open Admin settings</Link>} /><HealthIndicator /><div className="mt-8 panel"><Link to="/radar" className="request-link">Review governance findings</Link></div></>;
  const rows = (resource.data ?? []).filter((row) => role === "requester" || row.status === "awaiting_approval" || row.status === "human_review");
  return <><PageHeading title={role === "requester" ? "Your request workspace" : "Decisions that need you"} description={role === "requester" ? "Where are your requests, and what needs your attention? Sample items are clearly marked. This preview has no signed-in identity, so it shows all accessible requests." : "Review the requests waiting for a decision, with blockers and readiness visible before you open them."} action={<Link className="primary-action" to={role === "requester" ? "/requests" : "/approvals"}>{role === "requester" ? "Open requests" : "Open approval queue"}</Link>} /><ListState loading={resource.loading} error={resource.error} empty={!rows.length} retry={resource.reload} />{!resource.loading && !resource.error && role === "requester" ? Object.entries(STATUS).map(([status, meta]) => { const group = rows.filter((row) => row.status === status); return group.length > 0 && <section className="mb-8" key={status}><h2 className="section-title">{meta.label} <span className="text-muted-foreground">{group.length}</span></h2><RequestList rows={group} /></section>; }) : !resource.loading && !resource.error && rows.length > 0 && <RequestList rows={[...rows].sort((a, b) => Number(a.gates_passed === true) - Number(b.gates_passed === true))} />}</>;
}
