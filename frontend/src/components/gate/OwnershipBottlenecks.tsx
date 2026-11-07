import type { OwnershipBottleneck } from "@/lib/api";
import { displayText } from "@/lib/display-text";
import { Panel } from "./shared";

function Citations({ owner }: { owner: OwnershipBottleneck }) {
  return (
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        View citations for {owner.owner_name} ({owner.citations_total})
      </summary>
      <ul className="space-y-1 break-all font-mono text-xs">
        {owner.citations.map((citation) => (
          <li key={citation}>{citation}</li>
        ))}
      </ul>
      {owner.citations_total > owner.citations.length && (
        <p className="mt-2 text-muted-foreground">
          Showing {owner.citations.length} of {owner.citations_total} citations.
        </p>
      )}
    </details>
  );
}

export function OwnershipBottlenecks({ rows }: { rows?: OwnershipBottleneck[] | undefined }) {
  const ordered = [...(rows ?? [])].sort(
    (a, b) =>
      Number(b.status.toLowerCase() === "inactive") -
        Number(a.status.toLowerCase() === "inactive") || b.specs_blocked - a.specs_blocked,
  );
  const top = ordered[0];
  return (
    <Panel title="Ownership bottlenecks">
      {!top ? (
        <p className="text-sm text-muted-foreground">
          {rows
            ? "No ownership bottlenecks reported."
            : "Ownership bottleneck data is not available from this API."}
        </p>
      ) : (
        <div className="space-y-5">
          <article className="tone-amber min-w-0 rounded-lg border p-4">
            <p className="text-xs font-semibold uppercase tracking-wider">
              {top.status.toLowerCase() === "inactive"
                ? "Top inactive owner"
                : "Top ownership bottleneck"}
            </p>
            <h4 className="mt-2 break-words text-xl font-semibold">{top.owner_name}</h4>
            <p className="mt-1 text-sm">
              {top.owner_id} · {top.role} · {top.scope} · {top.status}
            </p>
            <p className="mt-4 text-2xl font-semibold">
              {top.specs_blocked} modelled specs blocked
            </p>
            <p className="mt-3 break-words text-sm">{displayText(top.fix)}</p>
            <p className="mt-2 break-words text-sm">
              Models: {top.semantic_models.join(", ") || "None"} · Assets owned: {top.assets_owned}
            </p>
            <Citations owner={top} />
          </article>
          {ordered.length > 1 && (
            <details>
              <summary className="min-h-16 cursor-pointer py-4 text-sm font-semibold">
                Other ownership bottlenecks ({ordered.length - 1})
              </summary>
              <ul className="divide-y text-sm">
                {ordered.slice(1).map((owner) => (
                  <li key={owner.owner_id} className="min-w-0 py-3">
                    <p className="break-words font-semibold">
                      {owner.owner_name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({owner.owner_id})
                      </span>{" "}
                      · {owner.specs_blocked} modelled specs blocked
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {owner.role} · {owner.scope} · {owner.status}
                    </p>
                    <p className="mt-2 break-words">{displayText(owner.fix)}</p>
                    <Citations owner={owner} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}
