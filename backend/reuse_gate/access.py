"""Least privilege by role, enforced by the API.

REUSE_GATE_ROLE_CODES holds one entry per person or seat, separated by ";": role:name:code, for example
"business:Maria Business:<code>;approver:Anna Approver:<code>". A request carries its code in X-Access-Code; the API maps it
to a role and a name and checks the role on every endpoint. Roles: business, analyst, developer, approver, admin, executive,
operator.

- Business sees and rechecks only the requests it created, and never approver names.
- Analyst and developer read every request and the evidence, with approver names hidden.
- Approver and admin approve, simulate and read the decision log.
- Who approved is the signed-in name, never a name sent in the body.
- Executive reads the plain-language report and the request list; operator reads the operations wall. Neither changes anything.
- Developers propose decision configuration changes; approvers decide them, never their own.
- A judge code ("judge:Judge:<code>") is for demo reviewers: it may view as any role, chosen per request with X-View-Role, and
  then gets exactly that role's data and rights, under the judge's own name. Viewing as business, a judge also sees the marked
  sample requests, so the view is not empty.

With no codes configured the API stays open as before (local development and tests); REUSE_GATE_WRITE_TOKEN alone still
guards approve and remediate. In production the role and name come from the identity provider (an OIDC token or the OpenShift
OAuth proxy) instead of a code; only principal() changes. Codes are compared in constant time and never logged.
"""
import hmac
import os
import sys
from dataclasses import dataclass

ROLES = ("business", "analyst", "developer", "approver", "admin", "executive", "operator")
EVERYONE = frozenset(ROLES)
READ_ALL = frozenset({"analyst", "developer", "approver", "admin", "executive", "operator"})
DECIDERS = frozenset({"approver", "admin"})

# What each role may do. Anything not granted is refused with 403.
PERMISSIONS = {
    "recommend": EVERYONE,
    "requests.create": frozenset({"business", "admin"}),
    "requests.read": EVERYONE - {"operator"},  # business: own items only, see can_see(); operators see queue counts only
    "speak": EVERYONE,
    "chat": EVERYONE - {"operator"},  # on items the caller may see
    "transcribe": frozenset({"business", "admin"}),
    "evaluation": EVERYONE,
    "radar": frozenset({"analyst", "approver", "admin"}),
    "owners": DECIDERS,
    "log": DECIDERS,
    "spec": frozenset({"developer", "approver", "admin"}),
    "remediate": DECIDERS,
    "approve": DECIDERS,
    "dashboards.read": frozenset({"analyst", "developer", "approver", "admin", "executive"}),
    "dashboards.write": frozenset({"analyst", "admin"}),
    "report": frozenset({"executive", "approver", "admin"}),
    "report.email": frozenset({"executive", "admin"}),
    "operations": frozenset({"operator", "approver", "admin"}),
    "config.read": frozenset({"developer", "approver", "admin"}),
    "config.propose": frozenset({"developer", "admin"}),
    "config.decide": DECIDERS,
    "notifications": frozenset({"admin"}),
}
MIN_CODE = 12


JUDGE = "judge"


@dataclass(frozen=True)
class Principal:
    role: str
    name: str
    enforced: bool = True
    judge: bool = False


OPEN = Principal("admin", "Local user", enforced=False)


def parse(raw):
    """[(role, name, code)] from the env value. Entries with an unknown role or a short code are skipped with a warning
    that names the entry's position, never its code."""
    entries = []
    for n, part in enumerate(p.strip() for p in (raw or "").split(";")):
        if not part:
            continue
        bits = [b.strip() for b in part.split(":")]
        if len(bits) >= 3:
            role, name, code = bits[0], bits[1], ":".join(bits[2:])
        else:
            role, name, code = bits[0], "", bits[1] if len(bits) == 2 else ""
        if (role not in ROLES and role != JUDGE) or len(code) < MIN_CODE:
            print(f"WARNING: REUSE_GATE_ROLE_CODES entry {n + 1} skipped: unknown role or code shorter than {MIN_CODE}", file=sys.stderr)
            continue
        entries.append((role, (name or role.capitalize())[:80], code))
    return entries


def codes():
    return parse(os.environ.get("REUSE_GATE_ROLE_CODES", ""))


def enforced():
    return bool(codes())


def principal(headers):
    """The caller, or None when codes are configured and the request has no valid one. Open mode returns OPEN."""
    entries = codes()
    if not entries:
        return OPEN
    given = (headers.get("X-Access-Code") or "").encode()
    match = None
    for role, name, code in entries:  # check every entry, so the time taken does not depend on which one matched
        if hmac.compare_digest(given, code.encode()) and match is None:
            match = Principal(role, name)
    if match and match.role == JUDGE:
        view = headers.get("X-View-Role") or "admin"
        match = Principal(view if view in ROLES else "admin", match.name, judge=True)
    return match


def allowed(who, action):
    return who.role in PERMISSIONS[action]


def can_see(who, item):
    """Business sees only its own items; every other role sees all of them."""
    return (who.role != "business" or not who.enforced or (item.get("requester") or "") == who.name
            or (who.judge and item.get("origin") == "sample"))


def redact(who, item):
    """A copy of a work item without approver names for roles that do not decide."""
    if who.role in DECIDERS or not who.enforced:
        return item
    item = dict(item)
    if item.get("decision"):
        item["decision"] = {**item["decision"], "approver": "An approver"}
    item["activity"] = [{**a, "actor": "Approver"} if a.get("event") in ("approved", "rejected", "remediation_simulated") else a
                        for a in item.get("activity", [])]
    return item
