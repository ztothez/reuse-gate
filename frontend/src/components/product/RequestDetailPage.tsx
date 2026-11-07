import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, MessageSquare } from "lucide-react";
import {
  getApiBaseUrl,
  getLog,
  getRequest,
  isDemo,
  saveRequest,
  type Answer,
  type WorkItem,
} from "@/lib/api";
import { RequestChat } from "./RequestChat";
import { displayText } from "@/lib/display-text";
import { requestGates } from "@/lib/governance";
import { roleTab, roleView, type RequestTab } from "@/lib/role";
import { itemsChanged, useResource } from "@/lib/use-resource";
import { openQuestions, type RequestState } from "@/lib/use-request";
import { ACTIONS } from "@/components/gate/shared";
import { RequesterView } from "@/components/gate/RequesterView";
import { GateComparison, GateList } from "@/components/gate/GateComparison";
import { DecisionRecordView } from "@/components/gate/DecisionRecordView";
import { ListenButton } from "@/components/gate/ListenButton";
import { useLens } from "./AppShell";
import { DecisionSource, DecisionSteps } from "./DecisionTrail";
import { EvidenceTab, SpecTab } from "./RequestTabs";
import { ListState, PageHeading, SampleTag, StatusBadge, localDate } from "./shared";
export function RequestDetailPage({ id }: { id: string }) {
  const resource = useResource(() => getRequest(id), id);
  if (!resource.data)
    return (
      <>
        <PageHeading
          title="Request"
          description="Load a saved request and its governance context."
        />
        <ListState
          loading={resource.loading}
          error={resource.error}
          empty={!resource.data}
          retry={resource.reload}
        />
      </>
    );
  return (
    <DetailContent
      key={resource.data.request_id + resource.data.updated}
      item={resource.data}
      reload={resource.reload}
    />
  );
}
// One sentence under the answer: KPI coverage when there is a target, otherwise the first rule line.
function summary(item: WorkItem) {
  const rec = item.result.recommendation;
  const coverage = rec.target?.coverage;
  if (coverage?.requested.length) {
    const missing = coverage.missing.length ? ` ${coverage.missing.join(", ")} needs adding.` : "";
    return `Covers ${coverage.covered.length} of ${coverage.requested.length} requested KPIs as primary.${missing}`;
  }
  if (rec.build_on)
    return `Build on the governed semantic model ${rec.build_on}, using canonical KPI definitions.`;
  return rec.rationale[0] ? displayText(rec.rationale[0]) : "";
}
function DetailContent({ item, reload }: { item: WorkItem; reload: () => void }) {
  const navigate = useNavigate();
  const [role] = useLens();
  const view = roleView(role);
  const [tab, setTab] = useState<RequestTab>(roleTab(role));
  useEffect(() => setTab(roleTab(role)), [role]);
  const approves = role === "approver" || role === "admin";
  // Chat needs the live API; the bundled fixture has no threads.
  const canChat = Boolean(getApiBaseUrl()) && !isDemo();
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState("");
  const [accepted, setAccepted] = useState(false);
  const questions = openQuestions(item.result);
  const rec = item.result.recommendation;
  const meta = ACTIONS[rec.action];
  const Icon = meta.icon;
  const gates = requestGates(item.result);
  const failing = gates?.gates.filter((gate) => !gate.passed).length ?? 0;
  const closed = item.status === "approved" || item.status === "rejected";
  const outdated = text !== item.text;
  async function check(fresh?: Answer[]) {
    if (closed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveRequest({
        request_id: item.request_id,
        text: fresh ? item.text : text,
        answers: fresh
          ? [...(item.result.answers ?? []), ...fresh]
          : outdated
            ? []
            : (item.result.answers ?? []),
        rounds: outdated && !fresh ? [] : item.rounds,
        ...(item.requester ? { requester: item.requester } : {}),
      });
      if (saved.request_id !== item.request_id)
        await navigate({ to: "/requests/$requestId", params: { requestId: saved.request_id } });
      else reload();
      itemsChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request could not be rechecked.");
    } finally {
      setBusy(false);
    }
  }
  const state: RequestState = {
    text,
    setText,
    loading: busy,
    error,
    result: item.result,
    rechecking: busy,
    submit: () => check(),
    recheck: (fresh) => check(fresh),
    accepted,
    setAccepted,
    decided: null,
    setDecided: () => {},
    reset: () => {
      void navigate({ to: "/requests", search: { create: "1" } });
    },
    outdated,
  };
  const allTabs: Record<RequestTab, { id: RequestTab; label: string; badge?: number }> = {
    answer: { id: "answer", label: role === "business" ? "Your answer" : "Answer" },
    evidence: { id: "evidence", label: "Evidence" },
    spec: { id: "spec", label: "Spec" },
    gates: { id: "gates", label: "Gates", badge: failing },
    activity: { id: "activity", label: role === "business" ? "Status" : "Activity" },
  };
  // Each role sees only its own tabs, in its own order.
  const tabs = view.tabs.map((id) => allTabs[id]);
  const title =
    rec.target?.name ?? (rec.build_on ? `New dashboard on ${rec.build_on}` : meta.label);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/requests" className="crumb underline">
          Requests
        </Link>
        <ChevronRight aria-hidden className="h-4 w-4" />
        <span className="text-foreground">{item.request_id}</span>
        {item.origin === "sample" && <SampleTag />}
        <span className="ml-auto">
          <StatusBadge status={item.status} />
        </span>
      </div>
      <h1 className="request-headline text-xl font-semibold sm:text-2xl">{item.text}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.requester ?? "Requester not provided"} · updated {localDate(item.updated)}
      </p>
      <section
        aria-label="Recommendation"
        className={`${meta.tone} panel mt-6 flex flex-wrap items-center gap-4`}
      >
        <Icon aria-hidden className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider">{meta.label}</p>
          <h2 className="mt-1 text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm">{summary(item)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(outdated && !closed) || item.local_only ? (
            <button
              className="primary-action"
              disabled={busy || !text.trim()}
              onClick={() => void check()}
            >
              {busy ? "Rechecking..." : "Recheck request"}
            </button>
          ) : item.status === "clarifying" && view.tabs.includes("answer") ? (
            <button className="primary-action" onClick={() => setTab("answer")}>
              Answer questions
            </button>
          ) : closed && view.tabs.includes("activity") ? (
            <button className="primary-action" onClick={() => setTab("activity")}>
              {role === "business" ? "See the decision" : "View decision record"}
            </button>
          ) : !closed && approves && item.status !== "clarifying" ? (
            <Link className="primary-action" to="/approvals" search={{ id: item.request_id }}>
              Review for approval
            </Link>
          ) : role === "developer" ? (
            <button className="primary-action" onClick={() => setTab("spec")}>
              Open spec
            </button>
          ) : role === "business" && !closed ? (
            <span className="text-sm">
              An approver decides next. You do not need to do anything.
            </span>
          ) : null}
          <button
            className="control"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => setCopy("Link copied."))
                .catch(() => setCopy("Could not copy. Copy the address from your browser."));
            }}
          >
            Copy link
          </button>
          {canChat && (
            <button
              type="button"
              className="control"
              onClick={() =>
                document.getElementById("discussion")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <MessageSquare aria-hidden className="h-4 w-4" /> Discussion
            </button>
          )}
        </div>
      </section>
      {copy && (
        <p role="status" className="mt-2 text-sm">
          {copy}
        </p>
      )}
      {item.local_only && (
        <p className="panel tone-amber mt-4">
          Local draft only. Not checked or saved by the live API. Recheck to create a server request
          when connected.
        </p>
      )}
      {outdated && (
        <p role="alert" className="panel tone-amber mt-4">
          Outdated result. Recheck the edited request before approval.
        </p>
      )}
      {error && (
        <p role="alert" className="panel tone-red mt-4">
          {error}
        </p>
      )}
      <div
        role="tablist"
        aria-label="Request sections"
        className="mb-6 mt-6 flex gap-1 overflow-x-auto border-b"
      >
        {tabs.map((entry, index) => (
          <button
            key={entry.id}
            id={`item-tab-${entry.id}`}
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`item-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            className={`-mb-px inline-flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm ${tab === entry.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground"}`}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                const target = tabs[next]!;
                setTab(target.id);
                document.getElementById(`item-tab-${target.id}`)?.focus();
              }
            }}
          >
            {entry.label}
            {entry.badge ? (
              <span
                className="tone-red rounded-full border px-2 text-xs"
                aria-label={`${entry.badge} failing`}
              >
                {entry.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`item-panel-${tab}`}
        aria-labelledby={`item-tab-${tab}`}
        className="min-w-0 space-y-6"
      >
        {tab === "answer" && (
          <>
            <DecisionSteps item={item} />
            {item.status === "human_review" && (
              <p className="panel tone-amber">
                Human review required.{" "}
                {item.result.loop?.stopped_because
                  ? displayText(item.result.loop.stopped_because)
                  : "A person must resolve this request. No automatic approval was made."}
              </p>
            )}
            {questions.length > 0 && !closed && <RequesterView key={item.updated} state={state} />}
            <section className="panel">
              <h2 className="section-title">In plain language</h2>
              <ul className="list-disc space-y-2 pl-5 text-base">
                {(item.result.ai?.explanation?.length
                  ? item.result.ai.explanation
                  : rec.rationale
                ).map((line) => (
                  <li key={line}>{displayText(line)}</li>
                ))}
              </ul>
              {item.result.ai?.speech && (
                <ListenButton key={item.result.ai.speech} text={item.result.ai.speech} large />
              )}
              {role !== "business" && <DecisionSource result={item.result} />}
            </section>
            {!closed && (role === "business" || role === "admin") && (
              <details className="panel">
                <summary className="min-h-16 cursor-pointer font-semibold">
                  Change the request
                </summary>
                <label htmlFor="edit-request" className="mt-3 block text-sm">
                  Changing the text makes the current recommendation outdated until rechecked.
                </label>
                <textarea
                  id="edit-request"
                  className="control mt-3 min-h-32 w-full text-base"
                  value={text}
                  disabled={busy}
                  onChange={(event) => setText(event.target.value)}
                />
              </details>
            )}
          </>
        )}
        {tab === "evidence" && (
          <EvidenceTab result={item.result} prompt={item.text} open={role === "analyst"} />
        )}
        {tab === "spec" && <SpecTab result={item.result} />}
        {tab === "gates" && (
          <>
            <section className="panel">
              <h2 className="section-title">Spec gates</h2>
              {gates?.gates.length ? (
                <GateList gates={gates} />
              ) : (
                <p>No spec gates apply to this decision.</p>
              )}
            </section>
            {item.remediation ? (
              <div className="panel">
                <p className="mb-4 font-semibold">Owner fix, simulated, not applied</p>
                <GateComparison simulation={item.remediation} />
              </div>
            ) : (
              failing > 0 && (
                <p className="panel">
                  No fix simulated yet. An owner gate can be cleared by simulating an owner in the
                  approval queue; a failed refresh or a missing certification has to be fixed on the
                  model first.
                </p>
              )
            )}
            {!closed && approves && item.status !== "clarifying" && (
              <Link className="primary-action" to="/approvals" search={{ id: item.request_id }}>
                Open in approval queue
              </Link>
            )}
          </>
        )}
        {tab === "activity" && (
          <>
            {item.decision && <ItemRecord item={item} />}
            <section className="panel">
              <h2 className="section-title">Activity trail</h2>
              {!item.activity.length && <p>No activity recorded.</p>}
              <ol className="divide-y">
                {[...item.activity]
                  .sort((a, b) => b.time.localeCompare(a.time))
                  .map((entry, index) => (
                    <li key={entry.time + index} className="py-4">
                      <p className="text-sm font-semibold">
                        {entry.event.replace(/_/g, " ")} · {entry.actor}
                      </p>
                      <p className="mt-1 text-sm">{displayText(entry.detail)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{localDate(entry.time)}</p>
                    </li>
                  ))}
              </ol>
            </section>
            <section className="panel">
              <h2 className="section-title">Clarification rounds ({item.rounds.length})</h2>
              {!item.rounds.length && (
                <p className="text-sm text-muted-foreground">No clarification rounds recorded.</p>
              )}
              <ol className="space-y-4">
                {item.rounds.map((round) => (
                  <li key={round.round}>
                    <h3 className="font-semibold">Round {round.round}</h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {round.questions.map((question, index) => (
                        <li key={index}>
                          <p>{question.phrased ?? question.text}</p>
                          <p className="mt-1 text-muted-foreground">
                            Answer:{" "}
                            {round.answers.find((answer) => answer.field === question.field)
                              ?.answer ?? "Awaiting answer"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </section>
      {canChat && <RequestChat id={item.request_id} />}
    </>
  );
}
function ItemRecord({ item }: { item: WorkItem }) {
  const resource = useResource(getLog);
  const record = resource.data?.find((row) => row.registered_id === item.decision?.registered_id);
  return (
    <>
      <ListState
        loading={resource.loading}
        error={resource.error}
        empty={false}
        retry={resource.reload}
      />
      {record?.record ? (
        <DecisionRecordView
          record={record.record}
          origin={record.mode === "demo" ? "demo" : "live"}
        />
      ) : (
        !resource.loading && (
          <div className="panel">
            <h2 className="section-title">Registered decision</h2>
            <p>
              {item.decision?.decision === "approve" ? "Approved" : "Rejected"} by{" "}
              {item.decision?.approver}
            </p>
            <p className="mt-2 text-sm">
              Owner: {item.decision?.owner}. Review date:{" "}
              {localDate(item.decision?.review_by ?? "")}.
            </p>
            <p className="mt-2 text-sm">No detailed record is available in the decision log.</p>
          </div>
        )
      )}
    </>
  );
}
