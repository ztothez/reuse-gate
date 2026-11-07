import { useState } from "react";
import { HelpCircle, Layers, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  Answer,
  Asset,
  DashboardSpec,
  GateResult,
  Question,
  RecommendResult,
} from "@/lib/api";
import type { Decided } from "@/lib/use-request";
import { ACTIONS, Chip, Endorsement, ErrorState, Panel } from "./shared";
import { ApprovalPanel } from "./ApprovalPanel";
import { FlowView } from "./FlowView";
import { ListenButton } from "./ListenButton";

const MAX_SHOWN = 5;

function AssetTable({ rows: all }: { rows: Asset[] }) {
  const rows = all.slice(0, MAX_SHOWN);
  const more = all.length - rows.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">ID</th>
            <th className="pr-3">Name</th>
            <th className="pr-3">Platform</th>
            <th className="pr-3">Endorsement</th>
            <th className="pr-3">Views 3m</th>
            <th className="pr-3">Owner</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="py-2 pr-3 font-mono text-xs">{a.id}</td>
              <td className="pr-3">{a.name}</td>
              <td className="pr-3">{a.platform ?? "-"}</td>
              <td className="pr-3">
                <Endorsement value={a.endorsement} />
              </td>
              <td className="pr-3 tabular-nums">{a.views_3m ?? "-"}</td>
              <td className="pr-3">{a.owner ?? "Unowned"}</td>
              <td className="text-xs text-muted-foreground">{a.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <p className="mt-2 text-sm font-medium">+{more} more</p>}
    </div>
  );
}

export function ResultView({
  result,
  onAnswers,
  rechecking,
  outdated,
  decided,
  onDecided,
}: {
  result: RecommendResult;
  onAnswers?: (answers: Answer[]) => void;
  rechecking?: boolean;
  outdated?: boolean | undefined;
  decided?: Decided | null | undefined;
  onDecided?: ((d: Decided) => void) | undefined;
}) {
  const { intent, recommendation: rec } = result;
  const meta = ACTIONS[rec.action] ?? ACTIONS.human_review;
  const Icon = meta.icon;
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [localSpec, setSpec] = useState<DashboardSpec | null>(null);
  const [localGates, setGates] = useState<GateResult | null>(null);
  // A decision made in another role carries its spec and gates with it.
  const spec = localSpec ?? decided?.spec ?? null;
  const gates = localGates ?? decided?.gates ?? null;
  const questions: Question[] =
    intent.questions ?? intent.clarifications.map((text) => ({ text, field: "model" }));
  const blocked = questions.length > 0 || !!outdated;
  const filled = questions.flatMap((q, i) => {
    const answer = answers[i]?.trim();
    return answer ? [{ field: q.field, question: q.text, answer }] : [];
  });

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {result.ai?.source && (
        <p
          role="note"
          className={`${result.ai.source === "rules" ? "tone-amber" : "tone-blue"} rounded-md border px-4 py-2 text-sm`}
        >
          <span className="font-semibold">
            Source:{" "}
            {result.ai.source === "rules"
              ? "rules"
              : `AI${result.ai.model ? ` (${result.ai.model})` : ""}`}
            {result.ai.cached ? ", saved answer" : ""}.
          </span>{" "}
          {result.ai.notice} The decision itself always comes from the same deterministic rules.
        </p>
      )}
      {result.pipeline && (
        <FlowView
          stages={result.pipeline}
          loop={result.loop}
          prompt={result.text}
          agentic={result.ai?.intent_source === "llm"}
        />
      )}

      <Panel title="Understood request">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Products</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {intent.products.map((p) => (
                <Chip key={p}>{p}</Chip>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Market</dt>
            <dd className="mt-1 font-medium">{intent.market}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">KPIs</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {intent.kpis.map((k) => (
                <Chip key={k}>{k}</Chip>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Request kind</dt>
            <dd className="mt-1 font-medium">{intent.kind.replace(/_/g, " ")}</dd>
          </div>
        </dl>
        {intent.clarifications.length > 0 && (
          <div className="mt-5 space-y-3 rounded-md border tone-amber p-4">
            <p className="flex items-center gap-2 font-medium">
              <HelpCircle className="h-4 w-4" /> Please answer before continuing
              {result.loop?.status === "asking" && (
                <span className="text-sm font-normal">
                  (round {result.loop.rounds_used + 1} of {result.loop.max_rounds})
                </span>
              )}
            </p>
            {questions.map((q, i) => (
              <div key={i}>
                <Label htmlFor={`cl-${i}`}>{q.phrased ?? q.text}</Label>
                <Input
                  id={`cl-${i}`}
                  className="mt-1 bg-card"
                  value={answers[i] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                />
              </div>
            ))}
            {onAnswers && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={filled.length === 0 || rechecking}
                  onClick={() => onAnswers(filled)}
                >
                  {rechecking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Apply answers
                  and check again
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className={`${meta.tone} flex items-start gap-4 rounded-lg border-2 p-6`} role="status">
        <Icon className="h-10 w-10 shrink-0" aria-hidden />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
            Recommendation
          </p>
          <p className="text-2xl font-semibold">{meta.label}</p>
          <p className="mt-1 text-sm opacity-90">{rec.rationale.join("; ")}</p>
        </div>
      </div>

      {result.ai?.explanation && (
        <Panel
          title="Plain-language explanation"
          caption={`Generated by ${result.ai.explanation_source === "llm" ? `AI${result.ai.model ? ` (${result.ai.model})` : ""}` : "the governed rule baseline"}.`}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {result.ai.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {result.ai.speech && <ListenButton key={result.ai.speech} text={result.ai.speech} />}
        </Panel>
      )}

      {rec.target && (
        <Panel title="Target report">
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="text-lg font-semibold">{rec.target.name}</p>
            <Chip mono>{rec.target.id}</Chip>
            <Endorsement value={rec.target.endorsement} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ["Platform", rec.target.platform],
              ["Status", rec.target.status],
              ["Views (3m)", rec.target.views_3m],
              ["Users (3m)", rec.target.users_3m],
              ["Owner", rec.target.owner ?? "Unowned"],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium tabular-nums">{v ?? "-"}</dd>
              </div>
            ))}
          </dl>
          {rec.target.coverage && (
            <div className="mt-4 border-t pt-4 text-sm">
              <p className="font-medium">Requested KPIs this report covers as primary</p>
              {rec.target.coverage.covered.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3">Requested KPI</th>
                        <th className="pr-3">Asset_KPI_Map id</th>
                        <th className="pr-3">Definition used</th>
                        <th className="pr-3">Status</th>
                        <th>Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.target.coverage.covered.map((c) => (
                        <tr key={c.map_id} className="border-t">
                          <td className="py-1 pr-3">{c.kpi}</td>
                          <td className="pr-3 font-mono text-xs">{c.map_id}</td>
                          <td className="pr-3">{c.kpi_name}</td>
                          <td className="pr-3">{c.definition_status.replace(/_/g, " ")}</td>
                          <td>{c.usage_role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(rec.target.coverage.secondary_only?.length ?? 0) > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Secondary only, not counted:</span>{" "}
                  {rec.target.coverage.secondary_only!.map((c) => (
                    <Chip key={c.map_id} mono>
                      {c.map_id}
                    </Chip>
                  ))}
                </p>
              )}
              {rec.target.coverage.missing.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Not covered as primary:</span>{" "}
                  {rec.target.coverage.missing.map((k) => (
                    <Chip key={k}>{k}</Chip>
                  ))}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {rec.target.coverage.note[0]?.toUpperCase()}
                {rec.target.coverage.note.slice(1)}.
              </p>
            </div>
          )}
        </Panel>
      )}

      {rec.build_on && (
        <p className="flex items-center gap-2 rounded-lg border bg-card px-5 py-3 text-sm">
          <Layers className="h-4 w-4 text-primary" /> <span className="font-medium">Build on:</span>{" "}
          Semantic model <Chip mono>{rec.build_on}</Chip>
        </p>
      )}

      {rec.retire.length > 0 && (
        <Panel
          title="Retire"
          caption={`Low usage, not certified, and a duplicate of the target${rec.retire_note ? `: ${rec.retire_note}` : ""}. All are cited under Evidence.`}
        >
          <AssetTable rows={rec.retire} />
        </Panel>
      )}
      {(rec.consolidate_later?.length ?? 0) > 0 && (
        <Panel
          title="Consolidate later"
          caption={`Overlapping assets that still have users or are certified: ${rec.consolidate_note}. All are cited under Evidence.`}
        >
          <AssetTable rows={rec.consolidate_later!} />
        </Panel>
      )}
      {rec.repair.length > 0 && (
        <Panel title="Repair">
          <ul className="divide-y text-sm">
            {rec.repair.map((r, i) => (
              <li key={i} className="py-2">
                {typeof r === "string" ? r : `${r.id} · ${r.name}`}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Why">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {rec.rationale.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Panel>

      <Panel title="Evidence" caption="Every recommendation cites the data it is based on.">
        <ul className="max-h-96 divide-y overflow-auto">
          {rec.evidence.map((e) => (
            <li key={e.table + e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Chip mono>
                {e.table} / {e.id}
              </Chip>
              <span>{e.note}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {spec && (
        <Panel
          title="Dashboard spec preview"
          caption="Generated after approval. This is a governed handoff, not a published dashboard."
        >
          <div className="space-y-3 text-sm">
            <p className="text-lg font-semibold">{spec.title}</p>
            <p>{spec.purpose}</p>
            <div className="flex flex-wrap gap-2">
              {spec.kpis.map((kpi) => (
                <Chip key={kpi}>{kpi}</Chip>
              ))}
            </div>
            <p>
              <span className="font-medium">Semantic model:</span>{" "}
              <Chip mono>{spec.semantic_model}</Chip>
            </p>
            {spec.owner && (
              <p>
                <span className="font-medium">Owner:</span> {spec.owner} ·{" "}
                <span className="font-medium">Review by:</span> {spec.review_date}
              </p>
            )}
            <ul className="list-disc space-y-1 pl-5">
              {spec.governance.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            {gates &&
              (gates.passed ? (
                <p role="status" className="tone-green rounded-md border p-3 font-medium">
                  All gates passed with this owner and review date.
                </p>
              ) : (
                <ErrorState>
                  Release is blocked.{" "}
                  {gates.gates
                    .filter((g) => !g.passed)
                    .map((g) => `${g.gate.replace(/_/g, " ")}: ${g.detail}`)
                    .join(". ")}
                </ErrorState>
              ))}
          </div>
        </Panel>
      )}
      <ApprovalPanel
        result={result}
        blocked={blocked}
        decided={decided}
        onDecided={onDecided}
        onSpec={(s, g) => {
          setSpec(s);
          setGates(g ?? null);
        }}
      />
    </div>
  );
}
