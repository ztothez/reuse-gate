import { useState } from "react";
import { Send } from "lucide-react";
import { getNotifications, sendTestEmail, type OutboxRow } from "@/lib/studio";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { ListState, PageHeading, localDate } from "./shared";

const TONE: Record<OutboxRow["status"], string> = {
  sent: "tone-green",
  queued: "tone-blue",
  failed: "tone-red",
  not_configured: "tone-gray",
  no_recipient: "tone-amber",
};
const ROLES = ["admin", "approver", "business", "developer", "executive", "analyst", "operator"];

// What the workflows are, which events send email, and the outbox of everything sent or not sent.
const FLOWS = [
  {
    name: "Reuse Gate notifications",
    trigger: "Webhook, checked with the webhook secret",
    does: "Emails each event to the role it concerns, through the SMTP credential held in n8n.",
  },
  {
    name: "Reuse Gate approval webhook",
    trigger: "Webhook, checked with the webhook secret",
    does: "Records an approve or reject decision through the API with the n8n API key.",
  },
  {
    name: "Reuse Gate radar digest",
    trigger: "Weekdays at 08:00",
    does: "Emails the radar: ownerless, high-reach uncertified, and reports to retire or review.",
  },
];
const EVENTS = [
  ["A request is ready for a decision or needs a person", "approver"],
  ["A request is approved or rejected", "business"],
  ["A config change is proposed", "approver"],
  ["A config change is approved or rejected", "developer"],
  ["An executive emails the report", "executive"],
];

export function WorkflowsPage() {
  const [role] = useLens();
  const state = useResource(() => getNotifications(), role);
  const [target, setTarget] = useState("admin");
  const [result, setResult] = useState<string | null>(null);
  const n = state.data;
  return (
    <>
      <PageHeading
        title="Workflows and email"
        description="Reuse Gate posts each event to n8n, and n8n sends the email. The SMTP password stays in n8n; this service never holds it."
      />
      <ListState loading={state.loading} error={state.error} empty={false} retry={state.reload} />
      {n && (
        <>
          <dl className="mb-8 grid gap-4 md:grid-cols-3">
            <div className={`panel ${n.configured ? "tone-green" : "tone-amber"}`}>
              <dt className="text-sm">Email</dt>
              <dd className="text-2xl font-semibold">
                {n.configured ? "Connected to n8n" : "Not configured"}
              </dd>
              <dd className="text-xs">
                Webhook {n.webhook ? "set" : "missing"}, secret {n.secret ? "set" : "missing"}
              </dd>
            </div>
            <div className="panel md:col-span-2">
              <dt className="text-sm text-muted-foreground">Recipients by role</dt>
              <dd className="mt-1 text-lg">
                {Object.keys(n.recipients).length
                  ? Object.entries(n.recipients)
                      .map(([r, c]) => `${r}: ${c} address${c === 1 ? "" : "es"}`)
                      .join(" · ")
                  : "None registered (REUSE_GATE_NOTIFY_EMAILS)"}
              </dd>
            </div>
          </dl>
          <section className="mb-8 grid gap-4 lg:grid-cols-3">
            {FLOWS.map((f) => (
              <article key={f.name} className="panel">
                <h2 className="font-semibold">{f.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{f.trigger}</p>
                <p className="mt-2 text-sm">{f.does}</p>
              </article>
            ))}
          </section>
          <section className="panel mb-8">
            <h2 className="section-title">Which events send email</h2>
            <table className="w-full text-sm">
              <tbody>
                {EVENTS.map(([event, to]) => (
                  <tr key={event}>
                    <td className="border-b p-2">{event}</td>
                    <td className="border-b p-2 text-right">to {to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label htmlFor="test-role" className="text-sm font-semibold">
                Send a test email to
              </label>
              <select
                id="test-role"
                className="control"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                className="primary-action"
                onClick={() => {
                  setResult(null);
                  sendTestEmail(target)
                    .then((row) => {
                      setResult(
                        `${row.id}: ${row.status.replace(/_/g, " ")}${row.detail ? ` (${row.detail})` : ""}`,
                      );
                      state.reload();
                    })
                    .catch((e: unknown) => setResult(e instanceof Error ? e.message : "Not sent."));
                }}
              >
                <Send aria-hidden className="h-4 w-4" /> Send test
              </button>
              {result && (
                <span role="status" className="text-sm">
                  {result}
                </span>
              )}
            </div>
          </section>
          <h2 className="section-title">
            Outbox <span className="text-muted-foreground">{n.outbox.length}</span>
          </h2>
          {!n.outbox.length && <p className="panel text-muted-foreground">Nothing sent yet.</p>}
          {n.outbox.length > 0 && (
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {["Time", "Event", "To role", "Subject", "By", "Status"].map((h) => (
                      <th key={h} className="border-b p-2 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {n.outbox.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b p-2 whitespace-nowrap">{localDate(row.time)}</td>
                      <td className="border-b p-2">{row.event}</td>
                      <td className="border-b p-2">
                        {row.role} ({row.to_count})
                      </td>
                      <td className="border-b p-2">{row.subject}</td>
                      <td className="border-b p-2">{row.actor ?? ""}</td>
                      <td className="border-b p-2">
                        <span
                          className={`${TONE[row.status]} rounded-full border px-2 py-0.5 text-xs font-semibold`}
                        >
                          {row.status.replace(/_/g, " ")}
                        </span>
                        {row.detail ? (
                          <span className="ml-2 text-xs text-muted-foreground">{row.detail}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
