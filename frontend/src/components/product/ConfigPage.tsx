import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import {
  decideChange,
  download,
  getConfig,
  proposeChange,
  type ConfigChange,
  type ConfigState,
} from "@/lib/studio";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { ListState, PageHeading, localDate } from "./shared";

const TONE: Record<ConfigChange["status"], string> = {
  proposed: "tone-blue",
  approved: "tone-green",
  rejected: "tone-gray",
};
const action = (a: string) => a.replace(/_/g, " ");

function ProposalForm({ config, onDone }: { config: ConfigState; onDone: () => void }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [synonyms, setSynonyms] = useState<{ phrase: string; kpi: string }[]>([]);
  const [alias, setAlias] = useState({ name: "", market: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const changed = Object.fromEntries(
      Object.entries(settings)
        .filter(([, v]) => v.trim() !== "")
        .map(([k, v]) => [k, Number(v)]),
    );
    setBusy(true);
    setError(null);
    proposeChange({
      settings: changed,
      kpi_synonyms: synonyms.filter((s) => s.phrase.trim()),
      market_aliases:
        alias.name.trim() && alias.market ? { [alias.name.trim()]: alias.market } : {},
      reason,
    })
      .then(() => {
        setSettings({});
        setSynonyms([]);
        setAlias({ name: "", market: "" });
        setReason("");
        onDone();
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "The change was not stored."),
      )
      .finally(() => setBusy(false));
  };
  return (
    <section className="panel mb-8">
      <h2 className="section-title">Propose a change</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Nothing changes in the running service. Your proposal is run against all 150 business
        requests, and the result goes to an approver. An approved change becomes a patch for the
        next release.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {config.tunables.map((t) => (
          <label key={t.key} className="block text-sm">
            <span className="font-semibold">{t.label}</span>
            <span className="block text-xs text-muted-foreground">
              Now {t.value}, allowed {t.min} to {t.max}
            </span>
            <input
              className="control mt-1 w-full"
              type="number"
              step={t.type === "int" ? 1 : 0.01}
              min={t.min}
              max={t.max}
              placeholder={String(t.value)}
              value={settings[t.key] ?? ""}
              onChange={(e) => setSettings({ ...settings, [t.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold">New KPI synonyms</h3>
      <p className="text-xs text-muted-foreground">
        A word your business uses for a canonical KPI, for example "turnover" for Net Sales.
      </p>
      {synonyms.map((s, i) => (
        <div key={i} className="mt-2 flex flex-wrap gap-2">
          <input
            className="control"
            aria-label="Phrase"
            placeholder="phrase"
            value={s.phrase}
            onChange={(e) =>
              setSynonyms(synonyms.map((x, j) => (j === i ? { ...x, phrase: e.target.value } : x)))
            }
          />
          <select
            className="control"
            aria-label="Canonical KPI"
            value={s.kpi}
            onChange={(e) =>
              setSynonyms(synonyms.map((x, j) => (j === i ? { ...x, kpi: e.target.value } : x)))
            }
          >
            {config.kpis.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button
            className="control"
            aria-label="Remove synonym"
            onClick={() => setSynonyms(synonyms.filter((_, j) => j !== i))}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        className="control mt-2"
        onClick={() => setSynonyms([...synonyms, { phrase: "", kpi: config.kpis[0] ?? "" }])}
      >
        <Plus aria-hidden className="h-4 w-4" /> Add synonym
      </button>
      <h3 className="mt-6 text-sm font-semibold">New market alias</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className="control"
          aria-label="Alias"
          placeholder="e.g. Deutschland"
          value={alias.name}
          onChange={(e) => setAlias({ ...alias, name: e.target.value })}
        />
        <select
          className="control"
          aria-label="Market"
          value={alias.market}
          onChange={(e) => setAlias({ ...alias, market: e.target.value })}
        >
          <option value="">Market...</option>
          {config.markets.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <label className="mt-6 block text-sm font-semibold" htmlFor="change-reason">
        Why
      </label>
      <textarea
        id="change-reason"
        className="control mt-1 w-full"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What problem does this fix, and for whom?"
      />
      {error && (
        <p role="alert" className="tone-red mt-3 rounded p-3 text-sm">
          {error}
        </p>
      )}
      <button
        className="primary-action mt-4"
        disabled={busy || reason.trim().length < 10}
        onClick={submit}
      >
        {busy ? "Measuring on 150 requests..." : "Measure impact and send for review"}
      </button>
    </section>
  );
}

function ChangeCard({
  change,
  canDecide,
  me,
  onDone,
}: {
  change: ConfigChange;
  canDecide: boolean;
  me: string | null;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { before, after } = change.impact;
  const own = me !== null && change.proposed_by === me;
  const decide = (d: "approve" | "reject") => {
    setError(null);
    decideChange(change.id, d, comment)
      .then(onDone)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Not decided."));
  };
  const lines = [
    ...Object.entries(change.settings).map(([k, v]) => `${k} = ${v}`),
    ...change.kpi_synonyms.map((s) => `"${s.phrase}" means ${s.kpi}`),
    ...Object.entries(change.market_aliases).map(([a, m]) => `"${a}" means market ${m}`),
  ];
  return (
    <article className="panel">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">
          {change.id}{" "}
          <span className="font-normal text-muted-foreground">
            by {change.proposed_by}, {localDate(change.created)}
          </span>
        </h3>
        <span
          className={`${TONE[change.status]} rounded-full border px-3 py-1 text-xs font-semibold`}
        >
          {change.status}
        </span>
      </header>
      <ul className="mt-3 list-disc pl-6 font-mono text-sm">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm">{change.reason}</p>
      <p className="mt-4 text-lg">
        New builds avoided: <strong>{before.avoided}</strong> → <strong>{after.avoided}</strong> of{" "}
        {after.total}.{" "}
        <span className={change.impact.changed_count ? "tone-amber rounded px-2" : ""}>
          {change.impact.changed_count} decision{change.impact.changed_count === 1 ? "" : "s"}{" "}
          change.
        </span>
      </p>
      {change.impact.changed.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold">Decisions that change</summary>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr>
                <th className="border-b p-2 text-left">Request</th>
                <th className="border-b p-2 text-left">Now</th>
                <th className="border-b p-2 text-left">With this change</th>
              </tr>
            </thead>
            <tbody>
              {change.impact.changed.map((c) => (
                <tr key={c.request_id}>
                  <td className="border-b p-2">{c.request_id}</td>
                  <td className="border-b p-2">
                    {action(c.before)} {c.before_target ?? ""}
                  </td>
                  <td className="border-b p-2">
                    {action(c.after)} {c.after_target ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {change.status !== "proposed" && (
        <p className="mt-3 text-sm text-muted-foreground">
          {change.status === "approved" ? "Approved" : "Rejected"} by {change.decided_by}
          {change.decided ? `, ${localDate(change.decided)}` : ""}. {change.comment}
        </p>
      )}
      {change.patch && (
        <button
          className="control mt-3"
          onClick={() =>
            download(`${change.id.toLowerCase()}-patch.json`, JSON.stringify(change.patch, null, 2))
          }
        >
          <Download aria-hidden className="h-4 w-4" /> Release patch
        </button>
      )}
      {canDecide && change.status === "proposed" && (
        <div className="mt-4 border-t pt-4">
          {own ? (
            <p className="text-sm text-muted-foreground">
              You proposed this change, so another approver decides it.
            </p>
          ) : (
            <>
              <label className="block text-sm font-semibold" htmlFor={`comment-${change.id}`}>
                Comment
              </label>
              <input
                id={`comment-${change.id}`}
                className="control mt-1 w-full"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button className="primary-action" onClick={() => decide("approve")}>
                  Approve for next release
                </button>
                <button className="control" onClick={() => decide("reject")}>
                  Reject
                </button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="tone-red mt-3 rounded p-3 text-sm">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// Developers change the decision configuration, not the report: every change is measured and reviewed by someone else.
export function ConfigPage() {
  const [role, , access] = useLens();
  const config = useResource(() => getConfig(), role);
  const canPropose = role === "developer" || role === "admin";
  const canDecide = role === "approver" || role === "admin";
  const changes = config.data?.changes ?? [];
  return (
    <>
      <PageHeading
        title="Decision configuration"
        description={
          canPropose
            ? "Tune the rules and the vocabulary that decide reuse. Each proposal is measured on all 150 requests before anyone approves it."
            : "Configuration changes proposed by developers, with their measured impact. Nobody approves their own change."
        }
      />
      <ListState
        loading={config.loading}
        error={config.error}
        empty={false}
        retry={config.reload}
      />
      {config.data && (
        <>
          {canPropose && <ProposalForm config={config.data} onDone={config.reload} />}
          <h2 className="section-title">
            Change requests <span className="text-muted-foreground">{changes.length}</span>
          </h2>
          {!changes.length && (
            <p className="panel text-muted-foreground">No change requests yet.</p>
          )}
          <div className="space-y-4">
            {changes.map((c) => (
              <ChangeCard
                key={c.id}
                change={c}
                canDecide={canDecide}
                me={access.enforced ? access.name : null}
                onDone={config.reload}
              />
            ))}
          </div>
          <section className="mt-8">
            <h2 className="section-title">In force now</h2>
            <dl className="grid gap-3 md:grid-cols-2">
              {config.data.tunables.map((t) => (
                <div key={t.key} className="panel">
                  <dt className="text-sm text-muted-foreground">{t.label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{t.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </>
  );
}
