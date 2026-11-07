import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { getLog, getRequest, saveRequest, type Answer, type WorkItem } from "@/lib/api";
import { displayText } from "@/lib/display-text";
import { requestGates } from "@/lib/governance";
import { itemsChanged, useResource } from "@/lib/use-resource";
import { openQuestions, type RequestState } from "@/lib/use-request";
import { itemRow } from "@/lib/work-item-cache";
import { ACTIONS } from "@/components/gate/shared";
import { RequesterView } from "@/components/gate/RequesterView";
import { FlowView } from "@/components/gate/FlowView";
import { GateComparison, GateList } from "@/components/gate/GateComparison";
import { DecisionRecordView } from "@/components/gate/DecisionRecordView";
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
function DetailContent({ item, reload }: { item: WorkItem; reload: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
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
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "clarification", label: `Clarification (${item.rounds.length})` },
    { id: "gates", label: "Gates" },
    { id: "activity", label: "Activity" },
    ...(item.decision ? [{ id: "record", label: "Decision record" }] : []),
  ];
  return (
    <>
      <PageHeading
        title={item.text}
        description="A saved request with a status, evidence and a decision trail."
        action={
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
        }
      />
      {copy && (
        <p role="status" className="mb-4 text-sm">
          {copy}
        </p>
      )}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <StatusBadge status={item.status} />
        {item.origin === "sample" && <SampleTag />}
        <span className="text-xs text-muted-foreground">{item.request_id}</span>
      </div>
      <dl className="mb-8 grid gap-4 rounded-lg bg-card p-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Requester", item.requester ?? "Not provided"],
          ["Owner", itemRow(item).owner ?? "Required"],
          ["Created", localDate(item.created)],
          ["Updated", localDate(item.updated)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {item.local_only && (
        <p className="panel tone-amber mb-6">
          Local draft only. This item and any sample recommendation have not been checked or saved
          by the live API. Recheck to create a server request when connected.
        </p>
      )}
      {outdated && (
        <p role="alert" className="panel tone-amber mb-6">
          Outdated result. Recheck the edited request before approval.
        </p>
      )}
      {error && (
        <p role="alert" className="panel tone-red mb-6">
          {error}
        </p>
      )}
      <div role="tablist" aria-label="Request sections" className="mb-6 flex flex-wrap gap-2">
        {tabs.map((entry, index) => (
          <button
            key={entry.id}
            id={`item-tab-${entry.id}`}
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`item-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            className={tab === entry.id ? "primary-action" : "control"}
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
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`item-panel-${tab}`}
        aria-labelledby={`item-tab-${tab}`}
        className="min-w-0 space-y-6"
      >
        {tab === "overview" && (
          <>
            <div className={`${meta.tone} panel`}>
              <div className="flex items-start gap-4">
                <Icon aria-hidden className="h-12 w-12 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider">Recommendation</p>
                  <h2 className="mt-2 text-2xl font-semibold">{meta.label}</h2>
                  {rec.target && <p className="mt-3 text-xl font-semibold">{rec.target.name}</p>}
                  {rec.build_on && (
                    <p className="mt-2 text-sm">
                      Build on a governed semantic model{" "}
                      <span className="font-mono">{rec.build_on}</span>
                    </p>
                  )}
                </div>
              </div>
              <ul className="mt-5 space-y-2 text-sm">
                {rec.rationale.map((line) => (
                  <li key={line}>{displayText(line)}</li>
                ))}
              </ul>
            </div>
            {item.status === "human_review" && (
              <p className="panel tone-amber">
                Human review required.{" "}
                {item.result.loop?.stopped_because
                  ? displayText(item.result.loop.stopped_because)
                  : "A person must resolve this request. No automatic approval was made."}
              </p>
            )}
            <section className="panel">
              <h2 className="section-title">Cited evidence</h2>
              <ul className="divide-y text-sm">
                {rec.evidence.map((entry) => (
                  <li key={entry.table + entry.id} className="py-3">
                    <p>{displayText(entry.note)}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {entry.table} / {entry.id}
                    </p>
                  </li>
                ))}
              </ul>
              {!rec.evidence.length && <p>No live evidence has been recorded.</p>}
            </section>
            {rec.repair.length > 0 && (
              <section className="panel">
                <h2 className="section-title">Proposed repair</h2>
                <ul className="space-y-2 text-sm">
                  {rec.repair.map((repair, index) => (
                    <li key={index}>
                      {displayText(
                        typeof repair === "string"
                          ? repair
                          : `${repair.name}: ${repair.reason ?? "Review required"}`,
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  These are proposed actions, not changes applied to a BI tool.
                </p>
              </section>
            )}
            {item.result.pipeline && (
              <details className="panel">
                <summary className="min-h-16 cursor-pointer font-semibold">
                  How this request was processed
                </summary>
                <div
                  className="overflow-x-auto max-h-[70vh] max-w-full"
                  tabIndex={0}
                  role="region"
                  aria-label="Request processing flow"
                >
                  <FlowView
                    stages={item.result.pipeline}
                    loop={item.result.loop}
                    prompt={item.text}
                    agentic={item.result.ai?.intent_source === "llm"}
                  />
                </div>
              </details>
            )}
            {!closed && (
              <section className="panel">
                <h2 className="section-title">Edit request</h2>
                <label htmlFor="edit-request" className="text-sm">
                  Changing the text makes the current recommendation outdated until rechecked.
                </label>
                <textarea
                  id="edit-request"
                  className="control mt-3 min-h-32 w-full text-base"
                  value={text}
                  disabled={busy}
                  onChange={(event) => setText(event.target.value)}
                />
              </section>
            )}
          </>
        )}
        {tab === "clarification" && (
          <>
            {questions.length > 0 && !closed ? (
              <RequesterView key={item.updated} state={state} />
            ) : (
              <p className="panel">
                {item.status === "human_review"
                  ? "The clarification loop needs a person to decide. No more questions are being asked automatically."
                  : "No open clarification questions."}
              </p>
            )}
            <section className="panel">
              <h2 className="section-title">Clarification history</h2>
              {!item.rounds.length && (
                <p className="text-sm text-muted-foreground">No clarification rounds recorded.</p>
              )}
              <ol className="space-y-5">
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
        {tab === "gates" && (
          <>
            <section className="panel">
              <h2 className="section-title">Original spec gates</h2>
              {gates ? <GateList gates={gates} /> : <p>No spec gates apply to this decision.</p>}
            </section>
            {item.remediation ? (
              <div className="panel">
                <p className="mb-4 font-semibold">Simulated, not applied</p>
                <GateComparison simulation={item.remediation} />
              </div>
            ) : (
              <p className="panel">No remediation simulation has been recorded.</p>
            )}
          </>
        )}
        {tab === "activity" && (
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
        )}
        {tab === "record" && item.decision && <ItemRecord item={item} />}
      </section>
      <div className="sticky bottom-0 z-10 mt-8 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-panel">
        <p className="text-sm text-muted-foreground">
          {closed
            ? "A decision is registered for this request."
            : outdated
              ? "Recheck before approving."
              : item.status === "clarifying"
                ? "Your answers are needed."
                : "The next decision is yours."}
        </p>
        {(outdated && !closed) || item.local_only ? (
          <button
            className="primary-action"
            disabled={busy || !text.trim()}
            onClick={() => void check()}
          >
            {busy ? "Rechecking..." : "Recheck request"}
          </button>
        ) : item.status === "clarifying" ? (
          <button
            className="primary-action"
            onClick={() => {
              setTab("clarification");
              document.getElementById("item-tab-clarification")?.focus();
            }}
          >
            Answer questions
          </button>
        ) : closed ? (
          <button className="primary-action" onClick={() => setTab("record")}>
            View decision record
          </button>
        ) : (
          <Link className="primary-action" to="/approvals" search={{ id: item.request_id }}>
            Review for approval
          </Link>
        )}
      </div>
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
