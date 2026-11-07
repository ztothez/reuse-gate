import type { Evidence, RecommendResult } from "./api";

// One plain-language sentence per decision. The detail stays in the Steward view.
export function plainAnswer(result: RecommendResult): string {
  const { action, target } = result.recommendation;
  if (result.loop?.status === "human_review")
    return `We could not make this request clear after ${result.loop.max_rounds} rounds of questions, so a person will review it. Nothing was decided.`;
  const name = target?.name;
  if (name) {
    switch (action) {
      case "reuse":
        return `${name} already answers this. Use it instead of building a new report.`;
      case "repair_and_reuse":
        return `${name} already answers this. Use it while its owner makes a small fix.`;
      case "extend":
        return `${name} covers most of this. It will be extended, so no new report is needed.`;
      case "migrate":
        return `${name} answers this. It is moving to Power BI, so no new report is needed.`;
      case "retire_and_reuse":
        return `Use ${name}. It answers this, and older copies will be retired.`;
    }
  }
  if (action === "new_build")
    return "No existing report covers this yet. A new one can be built on governed data after approval.";
  return "A person needs to look at this. An approver will review your request.";
}

const RULES = "Governance_Rules";

// Rows about the estate come first; the generic governance rules are counted separately.
export function evidenceSummary(evidence: Evidence[]) {
  const tables = new Set(evidence.map((e) => e.table));
  const rules = evidence.filter((e) => e.table === RULES).length;
  const top = [
    ...evidence.filter((e) => e.table !== RULES),
    ...evidence.filter((e) => e.table === RULES),
  ].slice(0, 3);
  return { rows: evidence.length, tables: tables.size, rules, top };
}
