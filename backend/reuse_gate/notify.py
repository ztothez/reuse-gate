"""Email notifications through an n8n workflow: the API posts an event, n8n sends it with its SMTP credential.

REUSE_GATE_NOTIFY_URL      the n8n webhook (Production URL of the "Reuse Gate notifications" workflow)
N8N_WEBHOOK_SECRET         sent as X-Webhook-Secret; n8n checks it with its header credential
REUSE_GATE_NOTIFY_EMAILS   who gets which role's mail: "approver:anna@example.com;business:maria@example.com,ops@example.com"
REUSE_GATE_UI_URL          the app address used in links

Every event is written to the outbox with its status (sent, failed, not_configured, no_recipient), so an admin sees what was
sent and what was not. Sending runs in a thread and never delays or fails the request that caused it. The SMTP password lives
in n8n only; this service never holds it.
"""
import json
import os
import sys
import threading
import urllib.request
import uuid
from datetime import datetime, timezone

from reuse_gate.access import ROLES

TIMEOUT = 15
OUTBOX = None  # a JsonlStore, set at startup


def recipients(role):
    mapping = {}
    for part in os.environ.get("REUSE_GATE_NOTIFY_EMAILS", "").split(";"):
        if ":" in part:
            r, emails = part.split(":", 1)
            mapping[r.strip()] = [e.strip() for e in emails.split(",") if "@" in e]
    return mapping.get(role, [])


def configured():
    return bool(os.environ.get("REUSE_GATE_NOTIFY_URL") and os.environ.get("N8N_WEBHOOK_SECRET"))


def status():
    """For the admin Workflows page: what is configured, never the values."""
    return {"configured": configured(), "webhook": bool(os.environ.get("REUSE_GATE_NOTIFY_URL")),
            "secret": bool(os.environ.get("N8N_WEBHOOK_SECRET")),
            "recipients": {r: len(recipients(r)) for r in ROLES if recipients(r)}}


def _deliver(row, payload):
    req = urllib.request.Request(os.environ["REUSE_GATE_NOTIFY_URL"], data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Webhook-Secret": os.environ["N8N_WEBHOOK_SECRET"]})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            ok = 200 <= resp.status < 300
            row = {**row, "status": "sent" if ok else "failed", "detail": f"n8n answered {resp.status}"}
    except Exception as exc:  # any failure is recorded, never raised
        row = {**row, "status": "failed", "detail": type(exc).__name__}
    row["finished"] = datetime.now(timezone.utc).isoformat()
    if OUTBOX is not None:
        OUTBOX.put(row)


def send(event, role, subject, text, link=None, actor=None, wait=False):
    """Queue one email to everyone mapped to role. Returns the outbox row."""
    to = recipients(role)
    ui = os.environ.get("REUSE_GATE_UI_URL", "").rstrip("/")
    url = f"{ui}{link}" if ui and link else None
    row = {"id": "MSG-" + uuid.uuid4().hex[:8].upper(), "event": event, "role": role, "to_count": len(to), "subject": subject[:150],
           "actor": actor, "link": url, "time": datetime.now(timezone.utc).isoformat(),
           "status": "queued" if configured() and to else "not_configured" if not configured() else "no_recipient"}
    if OUTBOX is not None:
        OUTBOX.put(row)
    if row["status"] != "queued":
        return row
    body = text + (f"\n\nOpen in Reuse Gate: {url}" if url else "") + "\n\nSent by Reuse Gate. Data: Bayer's synthetic data pack."
    payload = {"event": event, "to": ", ".join(to), "subject": f"Reuse Gate: {subject}"[:160], "text": body, "id": row["id"]}
    if wait:
        _deliver(row, payload)
        return OUTBOX.get(row["id"]) if OUTBOX is not None else row
    threading.Thread(target=_deliver, args=(row, payload), daemon=True).start()
    return row


def safe(fn, *args, **kwargs):
    """Notify without ever breaking the caller."""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        sys.stderr.write(f"notification skipped: {type(exc).__name__}\n")
        return None
