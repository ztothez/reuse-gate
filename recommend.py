"""Deterministic recommender: reuse, repair, extend, retire, migrate or new build.

An LLM sits on top (intent parsing, explanations). The decision itself is rule based so it is
repeatable and auditable. Every recommendation carries evidence as (table, id, note) tuples,
which supports RULE-008 (explain every lifecycle action with cited evidence).
"""
import re
from dataclasses import dataclass, field

import kpi_match
from llm import LLM, LLMError

LEGACY = re.compile(r"legacy tableau", re.I)
KEEP_PATHS = {"MIGRATE", "REBUILD_ON_SHARED_MODEL", "CONSOLIDATE_BEFORE_MIGRATION"}

TRUST = {"certified": 1.0, "promoted": 0.7, "none": 0.2}
HEALTH = {"active": 1.0, "candidate_retire": 0.3, "legacy": 0.1}
LOW_VIEWS = 100  # fewer views than this in the last 3 months means the asset is not alive
GLOBAL = "Global"
COVERAGE_PREFIX = "requested KPIs this target covers:"
RETIRE_AFTER_BUILD_NOTE = "retire after the new asset is live"
CONSOLIDATE_NOTE = "migrate users first, owner review required"
NAME_NOTE = "asset names in the data pack are not used for matching because they do not reflect coverage"
MIN_TEXT = 10
MAX_TEXT = 2000  # longer requests are cut before parsing or any LLM call
MAX_LLM_CLARIFICATIONS = 3
MAX_ANSWERS = 10
MAX_ANSWER = 300
CONFIRM = re.compile(r"^\s*(yes|y|ok|okay|confirm(ed)?|correct|right|sure|fine|agreed)\b", re.I)
ALL_PRODUCTS = re.compile(r"\b(all( products)?|whole portfolio|portfolio)\b", re.I)
ASSET_ID = re.compile(r"\bAST-\d+\b", re.I)
ASKS_FOR_ASSET = re.compile(r"\b(reuse|re-use|bring back|revive|restore|reopen|reactivate|keep using)\b", re.I)
INJECTION = re.compile(
    r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|prompts?|rules?|polic(y|ies)|guardrails?|gates?)\b"
    r"|system prompt|you are now|developer mode|jailbreak"
    r"|\b(reveal|print|show)\b.{0,30}\b(api key|keys?|tokens?|secrets?|prompt)\b"
    r"|\b(mark|set|make)\b.{0,40}\bas (certified|approved)\b"
    r"|auto[- ]?approve|\bskip\b.{0,20}\b(approval|gates?|governance)\b",
    re.I | re.S,
)


class Question(str):
    """A clarification that knows which field an answer fills. Serializes as a plain string."""

    def __new__(cls, field_name, text):
        q = super().__new__(cls, text)
        q.field = field_name
        return q


@dataclass
class Intent:
    request_id: str
    text: str
    products: list
    market: str
    kpis: list
    kind: str = "new_report"  # or "migration"
    clarifications: list = field(default_factory=list)
    variants: list = field(default_factory=list)  # non-canonical KPI ids named in the request
    named_assets: list = field(default_factory=list)  # existing asset ids named in the request
    missing_assets: list = field(default_factory=list)  # named ids that do not exist in the estate
    blocked: str | None = None  # why this request must go to a person without a decision


@dataclass
class Recommendation:
    action: str  # reuse | repair_and_reuse | extend | new_build | retire_and_reuse | migrate | retire | human_review
    target: str | None = None
    build_on: str | None = None  # semantic model to build on
    retire: list = field(default_factory=list)  # low usage, not certified, and a duplicate of the target
    consolidate: list = field(default_factory=list)  # every other overlapping asset: it has users or is certified
    item_notes: dict = field(default_factory=dict)  # asset id -> why it is on its list
    item_citations: dict = field(default_factory=dict)  # asset id -> evidence ids
    repair: list = field(default_factory=list)
    rationale: list = field(default_factory=list)
    evidence: list = field(default_factory=list)  # (table, id, note)
    clarifications: list = field(default_factory=list)


def precheck(text):
    """Requests that must not reach the parser or an LLM. Returns (reason, question) or None."""
    if len(text.strip()) < MIN_TEXT or not re.search(r"\w{2}", text):
        return ("the request is empty or too short to act on",
                "describe the report you need: which product, market and metrics?")
    if INJECTION.search(text):
        return ("the request contains instructions aimed at the system; they were ignored and no model was called",
                "restate the business need only: which product, market and metrics?")
    return None


def _named_markets(est, text):
    """Markets and regions named in the text, in order of appearance. All-caps aliases are case-sensitive, so "us" is not US."""
    terms = [(m["market_name"], i) for i, m in est.markets.items()] + [(m["region"], m["region"]) for m in est.markets.values()]
    terms += list(est.catalog.get("market_aliases", {}).items())
    hits = {}
    for term, market in terms:
        flags = 0 if term.isupper() else re.I
        m = re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, flags)
        if m:
            hits[market] = min(m.start(), hits.get(market, m.start()))
    return sorted(hits, key=hits.get)


def resolve_market(est, req, text, model_market=None):
    """Batch requests carry a market in their metadata. Ad hoc requests have none, so read it from the text."""
    if req["market_context"]:
        return model_market or req["market_context"], []
    named = _named_markets(est, text)
    if len(named) == 1:
        return named[0], []
    if named:
        regions = {est.markets[m]["region"] if m in est.markets else m for m in named}
        market = regions.pop() if len(regions) == 1 else GLOBAL
        return market, [Question("market", f"several markets were named ({', '.join(named)}): searched {market}, please confirm")]
    if re.search(r"\b(global|globally|worldwide)\b", text, re.I):
        return GLOBAL, []
    if model_market:
        return model_market, [Question("market", f"no market name was recognised, so the model's reading of {model_market} was used: please confirm")]
    return GLOBAL, [Question("market", "no market was named: searched all markets (Global), please confirm")]


def target_coverage(est, intent, asset_id):
    """Which requested KPIs the target covers, from Asset_KPI_Map only. Never from the asset name."""
    rows = []
    for kid in est.asset_kpis.get(asset_id, []):
        k = est.kpis[kid]
        if k["canonical_metric"] in intent.kpis:
            rows.append({"kpi": k["canonical_metric"], "map_id": f"{asset_id}:{kid}", "kpi_id": kid, "kpi_name": k["kpi_name"],
                         "definition_status": k["definition_status"], "usage_role": est.kpi_roles[(asset_id, kid)]})
    rows.sort(key=lambda c: (intent.kpis.index(c["kpi"]), c["kpi_id"]))
    covered = [c for c in rows if c["usage_role"] == "primary"]
    names = {c["kpi"] for c in covered}
    return {"requested": list(intent.kpis), "covered": covered, "secondary_only": [c for c in rows if c["kpi"] not in names],
            "missing": [k for k in intent.kpis if k not in names], "note": NAME_NOTE}


def _guard_notes(est, text):
    """Deterministic checks shared by the rule and LLM parsers."""
    low, notes = text.lower(), []
    if len(text) > MAX_TEXT:
        notes.append(Question("confirm", f"only the first {MAX_TEXT} characters were read: please confirm nothing important came later"))
    variants = []
    for k in est.kpis.values():
        if k["definition_status"] != "canonical" and k["kpi_name"] != k["canonical_metric"] and k["kpi_name"].lower() in low:
            variants.append(k["kpi_id"])
            notes.append(Question(
                "confirm",
                f"{k['kpi_name']} ({k['kpi_id']}, {k['definition_status']}) is not the approved definition: "
                f"{k['canonical_metric']} ({est.canonical.get(k['canonical_metric'])}) will be used, please confirm",
            ))
    ids = {m.upper() for m in ASSET_ID.findall(text)}
    # Asset names are often ordinary words, so a name only counts when the request asks for that report.
    by_name = {i for i, a in est.assets.items() if a["asset_name"].lower() in low} if ASKS_FOR_ASSET.search(text) else set()
    named = sorted((ids & set(est.assets)) | by_name)
    missing = sorted(ids - set(est.assets))
    if missing:
        notes.append(Question("restate", f"{', '.join(missing)} was not found: please restate the request with the report you mean"))
    return variants, named, missing, notes


def _unknown_names(est, text):
    """Capitalised words mid-sentence that nothing in the catalog explains, likely unknown products."""
    known = {w.lower() for w in est.catalog["known_terms"]} | {w.lower() for w in est.all_scope.split()}
    for source in [m["market_name"] for m in est.markets.values()] + [m["region"] for m in est.markets.values()] + list(est.canonical):
        known |= {w.lower() for w in source.split()}
    unknown = []
    for m in re.finditer(r"\b[A-Z][a-z][\w-]*", text):
        before = text[: m.start()].rstrip()
        if before and before[-1] not in ".!?:" and m.group().lower() not in known and m.group() not in unknown:
            unknown.append(m.group())
    return unknown


def _kpis_in(est, text):
    """Canonical KPIs in the text: the catalog's request phrases, then canonical names."""
    kpis = []
    for pattern, names in est.catalog["kpi_patterns"]:
        if re.search(pattern, text, re.I):
            kpis += [n for n in names if n not in kpis]
    for name in est.canonical:
        if name not in kpis and re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text, re.I):
            kpis.append(name)
    return kpis


@dataclass
class Answers:
    """What the requester told us, read deterministically. Sent back in full on each re-check, so the API stays stateless."""
    text: str  # the request text the next parse should read
    base_text: str  # the request as restated, without appended answers
    products: list | None = None
    market: str | None = None
    kpis: list | None = None
    confirmed: set = field(default_factory=set)  # fields the requester accepted as proposed
    acknowledged: set = field(default_factory=set)  # exact questions the requester has answered
    unread: dict = field(default_factory=dict)  # field -> answer that could not be used
    applied: list = field(default_factory=list)  # answers to send back with the next re-check
    any: bool = False


def read_answers(est, text, answers, model_on=False):
    out = Answers(text, text)
    appended = []
    for item in answers[:MAX_ANSWERS]:
        field_name, answer = item.get("field", "model"), (item.get("answer") or "").strip()[:MAX_ANSWER]
        if not answer:
            continue
        out.any = True
        keep = True
        if INJECTION.search(answer):
            out.unread[field_name] = answer
            continue
        if field_name == "restate":
            out.base_text = answer
            keep = False  # it replaced the request, so nothing is left to re-apply
        elif field_name == "market":
            if _named_markets(est, answer) or re.search(r"\b(global|globally|worldwide|all markets|everywhere)\b", answer, re.I):
                out.market = resolve_market(est, {"market_context": None}, answer)[0]
            elif CONFIRM.search(answer):
                out.confirmed.add("market")
            else:
                out.unread["market"], keep = answer, False
        elif field_name == "product":
            named = [p for p in est.products if re.search(rf"\b{re.escape(p)}\b", answer, re.I)]
            if named:
                out.products = named
            elif ALL_PRODUCTS.search(answer) or re.search(est.catalog["cross_product_pattern"], answer, re.I):
                out.products = [est.all_scope]
            elif CONFIRM.search(answer):
                out.confirmed.add("product")
            else:
                out.unread["product"], keep = answer, False
        elif field_name == "kpi":
            exact = [k for k in est.canonical if k.lower() == answer.lower()]
            named = exact or _kpis_in(est, answer)
            if named:
                out.kpis = named
            elif CONFIRM.search(answer):
                out.confirmed.add("kpi")
            else:
                out.unread["kpi"], keep = answer, False
                if model_on:  # a model may still read it; the rule parser would only misread it
                    appended.append(answer)
        elif field_name == "model":
            appended.append(answer)
        if field_name == "confirm" or item.get("question"):
            out.acknowledged.add(item.get("question"))
        if keep:
            out.applied.append({"field": field_name, "question": item.get("question", ""), "answer": answer})
    out.text = ". ".join([out.base_text.rstrip(". ")] + appended) if appended else out.base_text
    return out


def apply_answers(est, intent, answers):
    """Pin what the requester said over whatever was parsed, then drop the questions that are settled."""
    if answers.market:
        intent.market = answers.market
    if answers.products:
        intent.products = answers.products
        if intent.blocked and not precheck(intent.text):
            intent.blocked = None
    if answers.kpis:
        intent.kpis = answers.kpis
    kept = []
    for q in intent.clarifications:
        name = getattr(q, "field", "model")
        settled = (
            (name == "model" and answers.any)  # a model question gets one round, so the loop always ends
            or (name == "confirm" and q in answers.acknowledged)
            or (name == "market" and (answers.market or "market" in answers.confirmed))
            or (name == "product" and (answers.products or ("product" in answers.confirmed and intent.products)))
            or (name == "kpi" and (answers.kpis or ("kpi" in answers.confirmed and intent.kpis)))
        )
        if settled:
            continue
        kept.append(Question(name, f"'{answers.unread[name]}' could not be used. {q}") if name in answers.unread else q)
    intent.clarifications = kept


def parse_request(est, req):
    """Rule-based baseline for /grill-me. The LLM replaces this and asks the user when unsure."""
    full, ctx = req["request_text"], req["product_context"]
    text = full[:MAX_TEXT]
    stop = precheck(full)
    if stop:
        return Intent(req["request_id"], text, [], req["market_context"] or GLOBAL, [], clarifications=[Question("restate", stop[1])], blocked=stop[0])
    variants, named, missing, notes = _guard_notes(est, full)
    products = [p for p in est.products if re.search(rf"\b{re.escape(p)}\b", text, re.I)]
    blocked = None
    if not products and re.search(est.catalog["cross_product_pattern"], text, re.I):
        products = [est.all_scope]  # cross-product request
    if not products:
        unknown = _unknown_names(est, text)
        if unknown:
            blocked = f"not in the loaded {est.catalog['division']} catalog: {', '.join(unknown)}, so nothing can be matched"
            notes.append(Question("product", f"not a known product: {', '.join(unknown)}. Which of {', '.join(est.products)} do you mean?"))
        else:
            products = [ctx]
            notes.append(Question("product", f"the request names no product: assumed {ctx} from the requester context, please confirm"))
    kind, kpis = "new_report", []
    if LEGACY.search(text):
        kind, kpis = "migration", list(est.catalog["migration_kpis"])
    else:
        kpis = _kpis_in(est, text)
        for kid in variants:
            metric = est.kpis[kid]["canonical_metric"]
            if metric not in kpis:
                kpis.append(metric)
        if not kpis:
            notes.append(Question("kpi", "no KPI could be identified: which metrics do you need? Requests in other languages may need rephrasing"))
    market, market_notes = resolve_market(est, req, text)
    return Intent(req["request_id"], text, products, market, kpis, kind, notes + market_notes,
                  variants, named, missing, blocked)


def clean_llm_intent(est, req, value):
    """Keep only allow-listed values from model output. Raises TypeError or LLMError on a bad shape."""
    products = [p for p in value.get("products", []) if p in est.products or p == est.all_scope]
    named = [p for p in est.products if re.search(rf"\b{re.escape(p)}\b", req["request_text"][:MAX_TEXT], re.I)]
    products = named or products  # a product named in the text always beats the model
    valid_markets = set(est.markets) | {m["region"] for m in est.markets.values()}
    market = value.get("market") if value.get("market") in valid_markets else req["market_context"]
    kpis = [k for k in value.get("kpis", []) if k in est.canonical]
    kind = value.get("kind") if value.get("kind") in ("new_report", "migration") else "new_report"
    clarifications = value.get("clarifications", [])
    if not isinstance(clarifications, list) or not all(isinstance(x, str) for x in clarifications):
        raise LLMError("LLM clarifications must be an array of strings")
    return products, market, kpis, kind, clarifications


def parse_request_llm(est, req, client=None, embedder=None):
    """Parse with the LLM, falling back to the auditable rule baseline on failure.

    The LLM only fills allow-listed fields. It never sees blocked requests and never picks the action.
    """
    client = client or LLM()
    if not client.configured or precheck(req["request_text"]):
        return parse_request(est, req), "rules"
    match_notes = []
    try:
        value = client.parse_intent(
            req["request_text"][:MAX_TEXT],
            est.products + [est.all_scope],
            list(est.markets) + [m["region"] for m in est.markets.values()],
            sorted({k["canonical_metric"] for k in est.kpis.values()}),
        )
        products, market, kpis, kind, clarifications = clean_llm_intent(est, req, value)
        if products and not kpis:
            phrases = [x for x in value.get("kpis", []) if isinstance(x, str)] or [req["request_text"][:MAX_TEXT]]
            for phrase, kpi, score in kpi_match.suggest(est, req["request_text"], phrases, client, embedder or kpi_match.embedder_from_env()):
                kpis.append(kpi)
                match_notes.append(Question("kpi", f"'{phrase[:80]}' was matched to the canonical KPI {kpi} (similarity {score}): please confirm"))
        if not products or not kpis:
            raise LLMError("LLM intent omitted required products or KPIs")
    except (LLMError, TypeError, AttributeError):  # malformed model output is a failure, not a crash
        return parse_request(est, req), "rules"
    variants, named, missing, notes = _guard_notes(est, req["request_text"])
    market, market_notes = resolve_market(est, req, req["request_text"][:MAX_TEXT], market)
    clarifications = [c[:300] for c in clarifications[:MAX_LLM_CLARIFICATIONS]] + match_notes + notes + market_notes
    return Intent(req["request_id"], req["request_text"][:MAX_TEXT], products, market, kpis, kind, clarifications,
                  variants, named, missing), "llm"


def product_ok(est, products, scope):
    return scope in products or scope == est.all_scope


def market_ok(est, ctx, asset_market):
    if asset_market == "Global":
        return True
    if ctx in est.markets:
        return asset_market == ctx
    if ctx in {m["region"] for m in est.markets.values()}:
        return est.markets.get(asset_market, {}).get("region") == ctx
    return True


def assess(est, intent, a):
    aid = a["asset_id"]
    have, secondary = {}, set()
    for kid in est.asset_kpis.get(aid, []):
        metric = est.kpis[kid]["canonical_metric"]
        if est.kpi_roles[(aid, kid)] == "primary":  # a secondary mapping is incidental, so it is not coverage
            have.setdefault(metric, []).append(kid)
        else:
            secondary.add(metric)
    covered = [k for k in intent.kpis if k in have]
    missing = [k for k in intent.kpis if k not in have]
    variants = [k for k in covered if est.canonical.get(k) not in have[k]]

    fatal = []  # cannot be repaired cheaply: the asset is not alive
    if a["lifecycle_status"] != "active":
        fatal.append(f"lifecycle status is {a['lifecycle_status']}")
    if a["platform"] != "Power BI":
        fatal.append("legacy Tableau content, not a reuse target")
    if est.views(aid) < LOW_VIEWS:
        fatal.append(f"low adoption ({est.views(aid)} views in the last 3 months)")
    fixable = []  # governance gaps that a repair can close
    if a["endorsement"] not in ("certified", "promoted"):
        fixable.append("not certified or promoted")
    if not est.owner_active(a):
        fixable.append(f"owner {a['owner_id']} is missing or inactive")
    if variants:
        fixable.append(f"uses non-canonical KPI variants for {variants}")

    model = est.models.get(est.asset_model(aid))
    if model and model["refresh_status"] != "healthy":
        fixable.append(f"semantic model {model['model_id']} refresh status is {model['refresh_status']}")
    if model and model["ai_readiness"] == "poor":
        fixable.append(f"semantic model {model['model_id']} has poor AI readiness ({model['ai_issue_pattern']})")

    canon_share = 1.0 - (len(variants) / len(covered) if covered else 0.0)
    score = (
        0.35 * TRUST[a["endorsement"]]
        + 0.25 * est.views(aid) / est.max_views
        + 0.2 * HEALTH[a["lifecycle_status"]]
        + 0.2 * canon_share
    )
    return {
        "asset": a,
        "covered": covered,
        "missing": missing,
        "secondary_only": [k for k in missing if k in secondary],
        "fatal": fatal,
        "fixable": fixable,
        "alive": not fatal,
        "ready": not missing and not fatal and not fixable,
        "repairable": not missing and not fatal,
        "score": round(score, 3),
    }


def scoped_assessments(est, intent):
    return [
        assess(est, intent, a)
        for a in est.assets.values()
        if product_ok(est, intent.products, a["product_scope"]) and market_ok(est, intent.market, a["market_scope"])
    ]


def _evidence_for(est, x):
    a = x["asset"]
    aid = a["asset_id"]
    ev = [
        (
            "Analytics_Assets",
            aid,
            f"{a['asset_name']}: {a['lifecycle_status']}, {a['endorsement']}, audience {a['estimated_audience']}",
        ),
        ("Asset_Usage", aid, f"{est.views(aid)} views, {est.users(aid)} users in the last 3 months"),
    ]
    for metric in x["covered"]:
        kid = est.canonical.get(metric)
        if kid:
            ev.append(("KPI_Catalog", kid, f"{metric}: canonical, approved"))
    model = est.asset_model(aid)
    if model:
        m = est.models[model]
        ev.append(("Lineage_Edges", f"{model}->{aid}", "semantic dependency"))
        ev.append(
            ("Semantic_Models", model, f"{m['endorsement']}, refresh {m['refresh_status']}, AI readiness {m['ai_readiness']}")
        )
    for s in est.signals.get(aid, [])[:3]:
        ev.append(("Governance_Signals", s["signal_id"], f"{s['signal_code']} ({s['severity']}, {s['status']})"))
    return ev


def _rule(est, rule_id):
    return ("Governance_Rules", rule_id, est.rules[rule_id]["rule_name"])


def _pick_model(est, intent):
    ranked = []
    for m in est.models.values():
        if m["model_type"] != "Power BI semantic model" or m["refresh_status"] != "healthy":
            continue
        if not product_ok(est, intent.products, m["product_scope"]):
            continue
        ready = {"good": 2, "partial": 1, "poor": 0}[m["ai_readiness"]]
        owned = (est.owners.get(m["owner_id"]) or {}).get("status") == "active"
        ranked.append((m["endorsement"] == "certified", owned, ready, m["measure_count"], m["model_id"]))
    return max(ranked)[-1] if ranked else None


def _metrics(est, asset_id):
    return {est.kpis[k]["canonical_metric"] for k in est.asset_kpis.get(asset_id, [])}


def _is_duplicate(est, intent, rec, asset_id):
    """Duplicate means covering the same requested KPIs, from Asset_KPI_Map. Never judged from the asset name."""
    if rec.target:
        shared = set(intent.kpis) & _metrics(est, rec.target)
        return bool(shared) and shared <= _metrics(est, asset_id)
    if rec.action == "new_build":  # the planned build is the target
        return bool(intent.kpis) and set(intent.kpis) <= _metrics(est, asset_id)
    return est.backlog.get(asset_id, {}).get("recommended_path_candidate") == "RETIRE"  # no target: the backlog's own judgement


def _split_overlap(est, intent, rec):
    """Retire only low-usage, uncertified duplicates of the target. Everything else overlapping is consolidated later, so nothing is lost."""
    candidates, rec.retire = [a for a in rec.retire if a != rec.target], []
    for aid in candidates:
        a, views = est.assets[aid], est.views(aid)
        low, certified, duplicate = views < LOW_VIEWS, a["endorsement"] == "certified", _is_duplicate(est, intent, rec, aid)
        if low and not certified and duplicate:
            rec.retire.append(aid)
            rec.item_notes[aid] = f"{views} views in 3 months (below {LOW_VIEWS}), {a['endorsement']} endorsement, duplicates the requested KPIs"
            if rec.action == "new_build":
                rec.item_notes[aid] += f", {RETIRE_AFTER_BUILD_NOTE}"
        else:
            rec.consolidate.append(aid)
            why = [f"{views} views in 3 months"]
            if certified:
                why.append("certified")
            if not duplicate:
                why.append("not shown to duplicate the target")
            rec.item_notes[aid] = ", ".join(why)
        _cite_item(est, intent, rec, aid)
    if (rec.retire or rec.consolidate) and _rule(est, "RULE-006") not in rec.evidence:
        rec.evidence.append(_rule(est, "RULE-006"))
    if rec.retire:
        when = RETIRE_AFTER_BUILD_NOTE if rec.action == "new_build" else "can be retired"
        rec.rationale.append(f"{len(rec.retire)} low-usage, uncertified duplicate(s): {when}")
    if rec.consolidate:
        rec.rationale.append(f"{len(rec.consolidate)} other overlapping asset(s) to consolidate later: {CONSOLIDATE_NOTE}")
    if rec.action == "retire" and not rec.retire:
        rec.action = "human_review"
        rec.rationale.append("nothing meets the retire rule, so a person must decide")


def _cite_item(est, intent, rec, aid):
    """Every listed asset cites its own rows, including any hidden behind a "+N more" in the UI."""
    a = est.assets[aid]
    rows = [("Analytics_Assets", aid, f"{a['asset_name']}: {a['lifecycle_status']}, {a['endorsement']}, {a['platform']}"),
            ("Asset_Usage", aid, f"{est.views(aid)} views, {est.users(aid)} users in the last 3 months")]
    for kid in est.asset_kpis.get(aid, []):
        if est.kpis[kid]["canonical_metric"] in intent.kpis:
            rows.append(("Asset_KPI_Map", f"{aid}:{kid}", f"{aid} covers {est.kpis[kid]['canonical_metric']} through {est.kpis[kid]['kpi_name']}"))
    b = est.backlog.get(aid)
    if b:
        rows.append(("Migration_Backlog", aid, f"{b['recommended_path_candidate']}, {b['complexity']} complexity, {b['status']}"))
    seen = {(t, i) for t, i, _ in rec.evidence}
    rec.evidence += [r for r in rows if (r[0], r[1]) not in seen]
    rec.item_citations[aid] = [f"{r[0]}:{r[1]}" for r in rows]


def recommend(est, intent):
    rec = _review_gate(est, intent) or _decide(est, intent)
    _split_overlap(est, intent, rec)
    for kid in intent.variants:
        k = est.kpis[kid]
        rec.evidence.append(("KPI_Catalog", kid, f"{k['kpi_name']}: {k['definition_status']} variant of {k['canonical_metric']}, not used"))
        rec.rationale.append(f"{k['kpi_name']} conflicts with the approved {k['canonical_metric']}, so the canonical definition is used")
    if rec.target:
        cov = target_coverage(est, intent, rec.target)
        listed = "; ".join(f"{c['kpi']} (Asset_KPI_Map {c['map_id']}, primary, {c['definition_status']})" for c in cov["covered"]) or "none"
        rec.rationale.append(f"{COVERAGE_PREFIX} {listed}" + (f"; not covered as primary: {', '.join(cov['missing'])}" if cov["missing"] else ""))
        rec.rationale.append(NAME_NOTE)
        rec.evidence += [("Asset_KPI_Map", c["map_id"], f"{c['kpi_name']} ({c['definition_status']}), role {c['usage_role']}") for c in cov["covered"] + cov["secondary_only"]]
    return rec


def _review_gate(est, intent):
    """Requests that go to a person, with the reason, before any matching runs."""
    clar = list(intent.clarifications)
    if intent.blocked:
        return Recommendation("human_review", rationale=[intent.blocked, "no asset was matched and nothing was decided"], clarifications=clar)
    if intent.missing_assets:
        return Recommendation(
            "human_review",
            rationale=[f"{', '.join(intent.missing_assets)} does not exist in the asset catalog", "no asset was matched and nothing was decided"],
            clarifications=clar,
        )
    named = [assess(est, intent, est.assets[i]) for i in intent.named_assets]
    dead = [x for x in named if not x["alive"]]
    if dead:
        rec = Recommendation("human_review", retire=[x["asset"]["asset_id"] for x in dead], clarifications=clar)
        for x in dead:
            rec.rationale.append(f"{x['asset']['asset_name']} ({x['asset']['asset_id']}) is not a reuse target: {'; '.join(x['fatal'])}")
            rec.evidence += _evidence_for(est, x)
        rec.rationale.append("a person decides whether to retire it or revive it; it is not reused automatically")
        rec.evidence.append(_rule(est, "RULE-006"))
        return rec
    return None


def _decide(est, intent):
    if intent.kind == "migration":
        return _migration(est, intent)
    if not intent.kpis:
        return Recommendation(
            "human_review",
            rationale=["no KPI could be identified, so no existing report can be matched yet",
                       "ask the requester which metrics they need, then run the check again"],
            evidence=[_rule(est, "RULE-002")],
            clarifications=list(intent.clarifications),
        )

    scoped = scoped_assessments(est, intent)
    full = [x for x in scoped if not x["missing"]]
    overlap = [x["asset"]["asset_id"] for x in full]  # split into retire and consolidate once the target is known
    rec = Recommendation("new_build", retire=overlap, clarifications=list(intent.clarifications))

    ready = [x for x in full if x["ready"]]
    if ready:
        best = max(ready, key=lambda x: x["score"])
        rec.action, rec.target = "reuse", best["asset"]["asset_id"]
        rec.rationale = [
            f"{len(ready)} governed asset(s) already cover {intent.kpis}; best is {best['asset']['asset_name']}",
            "it is certified or promoted, active, adopted, owned, and uses the canonical KPI definitions",
        ]
        rec.evidence = _evidence_for(est, best) + [_rule(est, "RULE-001"), _rule(est, "RULE-002")]
        return rec

    repairable = [x for x in full if x["repairable"]]
    if repairable:
        best = max(repairable, key=lambda x: x["score"])
        rec.action, rec.target = "repair_and_reuse", best["asset"]["asset_id"]
        rec.repair = best["fixable"]
        rec.rationale = [
            f"{best['asset']['asset_name']} is alive and covers {intent.kpis} as primary KPIs, but has governance gaps",
            "closing the gaps is cheaper than a new build and avoids another overlapping asset",
        ]
        rec.evidence = _evidence_for(est, best) + [_rule(est, "RULE-001"), _rule(est, "RULE-005")]
        return rec

    partial = [x for x in scoped if x["alive"] and x["covered"]]
    if partial:
        best = max(partial, key=lambda x: (len(x["covered"]), x["score"]))
        if len(best["covered"]) / len(intent.kpis) >= 0.5:
            rec.action, rec.target = "extend", best["asset"]["asset_id"]
            rec.build_on = est.asset_model(rec.target)
            rec.repair = [f"add or promote to primary, with canonical definitions: {best['missing']}"] + best["fixable"]
            rec.rationale = [
                f"{best['asset']['asset_name']} is alive and covers {best['covered']} as primary KPIs; {best['missing']} is not covered as primary",
                "extend it on its existing semantic model instead of creating a new asset",
            ]
            rec.evidence = _evidence_for(est, best) + [_rule(est, "RULE-001"), _rule(est, "RULE-002")]
            return rec

    rec.build_on = _pick_model(est, intent)
    rec.rationale = [
        "no alive, governed asset covers enough of the request",
        "build on a healthy shared semantic model, using canonical KPI definitions only",
    ]
    rec.evidence = [_rule(est, "RULE-001"), _rule(est, "RULE-002"), _rule(est, "RULE-007")]
    if rec.build_on:
        m = est.models[rec.build_on]
        rec.evidence.append(
            ("Semantic_Models", rec.build_on, f"{m['endorsement']}, refresh {m['refresh_status']}, AI readiness {m['ai_readiness']}")
        )
    for metric in intent.kpis:
        kid = est.canonical.get(metric)
        if kid:
            rec.evidence.append(("KPI_Catalog", kid, f"{metric}: canonical, approved"))
    return rec


def _migration(est, intent):
    product = intent.products[0]
    legacy = [
        a
        for a in est.assets.values()
        if a["platform"] == "Tableau" and a["product_scope"] == product and market_ok(est, intent.market, a["market_scope"])
    ]

    def path(a):
        return est.backlog.get(a["asset_id"], {}).get("recommended_path_candidate")

    rec = Recommendation("new_build", clarifications=list(intent.clarifications))
    ready = [x for x in scoped_assessments(est, intent) if x["ready"]]
    if ready:
        best = max(ready, key=lambda x: x["score"])
        rec.action, rec.target = "retire_and_reuse", best["asset"]["asset_id"]
        rec.retire = [a["asset_id"] for a in legacy]
        rec.rationale = [
            f"a governed Power BI asset ({best['asset']['asset_name']}) already covers the commercial KPIs",
            "do not recreate the legacy Tableau workbooks 1:1",
        ]
        rec.evidence = _evidence_for(est, best) + [_rule(est, "RULE-006")]
        return rec

    if not legacy:
        rec.rationale = ["no legacy Tableau content found in scope, so treat as a new build"]
        rec.build_on = _pick_model(est, intent)
        return rec

    for a in legacy[:4]:
        b = est.backlog.get(a["asset_id"])
        if b:
            rec.evidence.append(
                ("Migration_Backlog", a["asset_id"], f"{b['recommended_path_candidate']}, {b['complexity']} complexity, {b['status']}")
            )
    rec.evidence.append(_rule(est, "RULE-006"))

    keepers = [a for a in legacy if path(a) in KEEP_PATHS]
    if keepers:
        top = max(keepers, key=lambda a: est.views(a["asset_id"]))
        b = est.backlog[top["asset_id"]]
        rec.action, rec.target = "migrate", top["asset_id"]
        rec.build_on = b.get("candidate_target_model_id") or _pick_model(est, intent)
        rec.retire = [
            a["asset_id"] for a in legacy if a["asset_id"] != top["asset_id"] and (path(a) == "RETIRE" or est.views(a["asset_id"]) < LOW_VIEWS)
        ]
        rec.rationale = [f"backlog path for {top['asset_name']} is {path(top)}; migrate it onto {rec.build_on}"]
        return rec

    if any(path(a) == "HUMAN_REVIEW" for a in legacy):
        rec.action = "human_review"
        rec.retire = [a["asset_id"] for a in legacy if path(a) == "RETIRE"]
        rec.rationale = ["the migration backlog marks the remaining legacy workbooks for human review, so a person must decide"]
        return rec

    rec.action = "retire"
    rec.retire = [a["asset_id"] for a in legacy]
    rec.rationale = ["every legacy workbook in scope is already a retire candidate in the migration backlog"]
    return rec
