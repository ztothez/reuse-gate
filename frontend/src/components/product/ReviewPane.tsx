import { Link } from "@tanstack/react-router";
import { getRequest, isDemo } from "@/lib/api";
import { useResource, itemsChanged } from "@/lib/use-resource";
import { openQuestions } from "@/lib/use-request";
import { ApprovalPanel } from "@/components/gate/ApprovalPanel";
import { ACTIONS } from "@/components/gate/shared";
import { ListState, StatusBadge, localDate } from "./shared";
export function ReviewPane({ id }: { id: string }) {
  const resource = useResource(() => getRequest(id), id); const item = resource.data;
  return <section aria-label="Review request" className="min-w-0 space-y-6"><ListState loading={resource.loading} error={resource.error} empty={!item} retry={resource.reload} />{item && <>
    <div className="panel"><p className="mb-3 text-xs text-muted-foreground">{item.request_id}</p><h2 className="section-title">{item.text}</h2><StatusBadge status={item.status} /><p className="mt-4 font-semibold text-primary">{ACTIONS[item.result.recommendation.action].label}</p><p className="mt-2 text-sm">{item.result.recommendation.target?.name ?? (item.result.recommendation.build_on ? `Governed model ${item.result.recommendation.build_on}` : "A person must review this request")}</p><Link className="request-link mt-3" to="/requests/$requestId" params={{ requestId: item.request_id }}>Open full request</Link></div>
    {item.decision ? <div className="panel"><h3 className="section-title">Decision recorded</h3><p>{item.decision.decision === "approve" ? "Approved" : "Rejected"} by {item.decision.approver}</p><p className="mt-2 text-sm">Owner: {item.decision.owner}. Review by {localDate(item.decision.review_by)}.</p><Link className="request-link" to="/log">Read decision record</Link></div> : <>
      {openQuestions(item.result).length > 0 && <p className="panel tone-amber">Approval waits for the requester to answer open questions. <Link className="underline" to="/requests/$requestId" params={{ requestId: item.request_id }}>Open clarification</Link></p>}
      <ApprovalPanel key={item.request_id + item.updated} readiness workItemId={item.request_id} workItemRounds={item.rounds} initialRemediation={item.remediation} result={item.result} blocked={openQuestions(item.result).length > 0} unavailableReason={item.local_only || isDemo() ? "Approval and simulation need the live API. Offline decisions are not recorded." : undefined} onDecided={() => itemsChanged()} />
      <p className="text-sm text-muted-foreground">If an access code is required, enter it in <Link className="underline" to="/admin">Admin settings</Link>. Codes are kept only for this browser session.</p>
    </>}
  </>}</section>;
}
