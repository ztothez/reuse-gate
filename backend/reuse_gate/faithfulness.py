"""Deterministic faithfulness check for AI explanations: every ID, KPI name, number and status they state must appear
in the decision or in the rows it cites. Anything else is an unsupported claim, and the explanation is not shown.

This catches invented facts, not wrong reasoning: a sentence can use only true facts and still draw a wrong conclusion.
"""
import json
import re

from reuse_gate.recommend import INJECTION

ID = re.compile(r"\b(?:AST|SM|OWN|KPI|RULE|REQ|SIG|MKT|PRD)-\d+\b", re.I)
NUMBER = re.compile(r"(?<![\w.-])\d[\d,]*(?:\.\d+)?%?(?![\w-])")
STATUS_FIELDS = (("assets", ("lifecycle_status", "endorsement")), ("models", ("endorsement", "refresh_status", "ai_readiness")))
IGNORED_STATUS = {"none", "good", "partial"}  # ordinary English words that would flag correct sentences


def status_words(est):
    words = set()
    for table, fields in STATUS_FIELDS:
        for row in getattr(est, table).values():
            words |= {str(row[f]).lower() for f in fields if row.get(f)}
    words |= {k["definition_status"].lower() for k in est.kpis.values()}
    words |= {o["status"].lower() for o in est.owners.values()}
    return {w for w in words if w not in IGNORED_STATUS}


def kpi_names(est):
    return {k["kpi_name"] for k in est.kpis.values()} | set(est.canonical)


def _row(est, table, key):
    if table == "Analytics_Assets":
        return est.assets.get(key)
    if table == "Asset_Usage":
        return {"views_3m": est.views(key), "users_3m": est.users(key)}
    if table == "Semantic_Models":
        return est.models.get(key)
    if table == "KPI_Catalog":
        return est.kpis.get(key)
    if table == "Governance_Rules":
        return est.rules.get(key)
    if table == "Owners":
        return est.owners.get(key)
    if table == "Migration_Backlog":
        return est.backlog.get(key)
    if table == "Asset_KPI_Map":
        asset, _, kpi = key.partition(":")
        return {"asset": asset, "kpi": est.kpis.get(kpi), "role": est.kpi_roles.get((asset, kpi))}
    if table == "Governance_Signals":
        return next((s for rows in est.signals.values() for s in rows if s["signal_id"] == key), None)
    return None


def support(est, result):
    """Everything an explanation may state: the request, the intent, the decision and the full rows it cites."""
    rec = result["recommendation"]
    rows = [_row(est, e["table"], e["id"]) for e in rec["evidence"]]
    corpus = json.dumps([result.get("text"), result["intent"], rec, rows], default=str)
    return corpus.lower()


def _numbers(text):
    return {n.replace(",", "").rstrip("%") for n in NUMBER.findall(text)}


DASHES = dict.fromkeys(map(ord, "\u2010\u2011\u2012\u2013\u2014\u2212"), "-") | dict.fromkeys(map(ord, "\u00a0\u202f\u2009"), " ")


def check(est, result, lines):
    """{passed, unsupported: [claims]} for the explanation lines against this result."""
    text = " ".join(lines).translate(DASHES)  # models write AST\u20110088 with a non-breaking hyphen
    corpus = support(est, result)
    corpus_numbers = _numbers(corpus) | {str(len(result["recommendation"][k])) for k in ("evidence", "retire", "consolidate_later")}
    unsupported = []
    for found in sorted({m.upper() for m in ID.findall(text)}):
        if found.lower() not in corpus:
            unsupported.append(f"id {found}")
    without_ids = ID.sub(" ", text)
    for n in sorted(_numbers(without_ids)):
        if n not in corpus_numbers:
            unsupported.append(f"number {n}")
    low = without_ids.lower()
    for name in sorted(kpi_names(est), key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(name.lower())}(?!\w)", low):
            if name.lower() not in corpus:
                unsupported.append(f"KPI {name}")
            low = low.replace(name.lower(), " ")  # a longer name already checked covers the shorter one inside it
    for word in sorted(status_words(est)):
        pattern = re.escape(word).replace(r"\_", "[_ ]")
        if re.search(rf"(?<!\w){pattern}(?!\w)", low) and not re.search(rf"(?<!\w){pattern}(?!\w)", corpus):
            unsupported.append(f"status {word}")
    if INJECTION.search(text):  # wording copied from a poisoned asset name or request, aimed at people or systems
        unsupported.append("instruction-like wording")
    return {"passed": not unsupported, "unsupported": unsupported}
