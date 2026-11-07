import { useState } from "react";
import { Mail, Printer } from "lucide-react";
import { ListenButton } from "@/components/gate/ListenButton";
import { emailReport, getReport, type OutboxRow } from "@/lib/studio";
import { useResource } from "@/lib/use-resource";
import { useLens } from "./AppShell";
import { ListState, PageHeading, localDate } from "./shared";

const MAIL: Record<OutboxRow["status"], string> = {
  sent: "Sent to the executive mailing list.",
  queued: "Queued for sending.",
  failed: "Sending failed. The admin can see why on the Workflows page.",
  not_configured: "Email is not set up on this server yet. Ask your admin.",
  no_recipient: "No email address is registered for the executive role yet. Ask your admin.",
};

// For executives: one page in plain words, every figure from live records, each section naming its source.
export function ExecutiveReport() {
  const [role] = useLens();
  const report = useResource(() => getReport(), role);
  const [mail, setMail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const r = report.data;
  const f = r?.figures ?? {};
  const max = Math.max(
    ...(r?.sales_by_product ?? []).map((s) => Math.max(s.net_sales, s.forecast)),
    1,
  );
  return (
    <div className="report mx-auto max-w-4xl">
      <PageHeading
        title="Executive report"
        description="What Reuse Gate found, in plain words. Built now from the data pack and the decisions on record; nothing here is written by a model."
        action={
          r && (
            <div className="no-print flex flex-wrap gap-2">
              <button className="control" onClick={() => window.print()}>
                <Printer aria-hidden className="h-4 w-4" /> Print or save as PDF
              </button>
              {role !== "approver" && (
                <button
                  className="control"
                  disabled={sending}
                  onClick={() => {
                    setSending(true);
                    setMail(null);
                    emailReport()
                      .then((row) => setMail(MAIL[row.status]))
                      .catch((e: unknown) =>
                        setMail(e instanceof Error ? e.message : "Sending failed."),
                      )
                      .finally(() => setSending(false));
                  }}
                >
                  <Mail aria-hidden className="h-4 w-4" />{" "}
                  {sending ? "Sending..." : "Email this report"}
                </button>
              )}
              <ListenButton text={[r.headline, ...r.actions].join(" ")} />
            </div>
          )
        }
      />
      {mail && (
        <p role="status" className="no-print tone-blue mb-4 rounded p-3 text-sm">
          {mail}
        </p>
      )}
      <ListState
        loading={report.loading}
        error={report.error}
        empty={false}
        retry={report.reload}
      />
      {r && (
        <>
          <p className="mb-6 text-sm text-muted-foreground">
            Generated {localDate(r.generated_at)}
          </p>
          <section className="panel mb-6">
            <p className="text-2xl font-semibold leading-snug">{r.headline}</p>
          </section>
          <dl className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              [
                "New builds avoided",
                f["avoided"] != null ? `${f["avoided"]} of ${f["requests"]}` : "n/a",
                "modelled",
              ],
              ["Reports in the estate", f["assets"], "today"],
              ["Unused or to retire", f["unused"], "today"],
              ["Without an active owner", f["ownerless"], "today"],
            ].map(([k, v, note]) => (
              <div key={String(k)} className="panel">
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="mt-1 text-3xl font-semibold tabular-nums">{v ?? "n/a"}</dd>
                <dd className="text-xs text-muted-foreground">{note}</dd>
              </div>
            ))}
          </dl>
          {r.sections.slice(1).map((s) => (
            <section key={s.title} className="mb-6">
              <h2 className="section-title">{s.title}</h2>
              <p className="max-w-3xl text-lg leading-relaxed">{s.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">Source: {s.source}</p>
            </section>
          ))}
          {r.sales_by_product.length > 0 && (
            <section className="mb-8">
              <h2 className="section-title">Net sales against forecast by product (M EUR)</h2>
              <ul className="space-y-3" aria-label="Net sales against forecast by product">
                {r.sales_by_product.map((s) => (
                  <li
                    key={s.product}
                    className="grid grid-cols-[8rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm"
                  >
                    <span className="font-semibold">{s.product}</span>
                    <span className="relative h-5 rounded bg-muted">
                      <span
                        className="absolute inset-y-0 left-0 rounded"
                        style={{ width: `${(100 * s.net_sales) / max}%`, background: "#1f5fbd" }}
                      />
                      <span
                        className="absolute inset-y-[-3px] w-0.5 bg-foreground"
                        style={{ left: `${(100 * s.forecast) / max}%` }}
                        title={`Forecast ${s.forecast}`}
                      />
                    </span>
                    <span className="text-right tabular-nums">
                      {s.net_sales.toLocaleString()} / {s.forecast.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Bar: net sales. Line: forecast. Actual-like months of Product_Market_Monthly
                (synthetic).
              </p>
            </section>
          )}
          {r.actions.length > 0 && (
            <section className="panel mb-6">
              <h2 className="section-title">Recommended actions</h2>
              <ol className="list-decimal space-y-2 pl-6 text-lg">
                {r.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ol>
            </section>
          )}
          <p className="text-sm text-muted-foreground">{r.data_note}</p>
        </>
      )}
    </div>
  );
}
