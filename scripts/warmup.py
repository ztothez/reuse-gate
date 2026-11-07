#!/usr/bin/env python3
"""Wake the live models before a demo, so the first person does not wait for a cold start.

Usage: python3 -I scripts/warmup.py [API URL]
Calls gpt-oss-120b (primary), GLM-5.2 (fallback) and the embedding model once each, bypassing the cache,
with a long timeout. Then calls GET /radar on the API (default: REUSE_GATE_API_URL, else the live route), so its
ownership bottleneck is computed and cached before the demo. Exit code: 0 primary ready, 1 only the fallback ready,
2 no chat model ready. The Radar call is reported and does not change the exit code. Never prints keys.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from reuse_gate.kpi_match import EMBED_MODEL, embedder_from_env
from reuse_gate.llm import LLMError, live_backends, load_env

TIMEOUT = 300
LIVE_API = "https://reuse-gate-ztothez-dev.apps.rm1.0a51.p1.openshiftapps.com"


def warm_radar(api):
    """GET /radar once. True when it answered with the ownership bottleneck in it."""
    started = time.monotonic()
    try:
        with urllib.request.urlopen(f"{api.rstrip('/')}/radar", timeout=60) as resp:
            body = json.load(resp)
    except (OSError, ValueError) as exc:
        print(f"radar {api}: FAILED after {time.monotonic() - started:.1f}s: {exc}", flush=True)
        return False
    if "ownership_bottlenecks" not in body:
        print(f"radar {api}: answered in {time.monotonic() - started:.1f}s, but without ownership_bottlenecks (older API)", flush=True)
        return False
    print(f"radar {api}: ready in {time.monotonic() - started:.1f}s", flush=True)
    return True


def check(label, call):
    started = time.monotonic()
    try:
        call()
    except (LLMError, OSError) as exc:
        print(f"{label}: FAILED after {time.monotonic() - started:.1f}s: {exc}", flush=True)
        return False
    print(f"{label}: ready in {time.monotonic() - started:.1f}s", flush=True)
    return True


def main():
    load_env()
    nonce = str(time.time())
    primary, fallback = live_backends(timeout=TIMEOUT, retries=2)
    ready = {}
    for name, client in (("primary", primary), ("fallback", fallback)):
        if client is None:
            print(f"{name}: no API key in the environment", flush=True)
            ready[name] = False
            continue
        client.use_cache, client.retry_wait = False, 10
        message = [{"role": "user", "content": f"Reply with the word ready. Ref {nonce}"}]
        ready[name] = check(f"{name} {client.model}", lambda c=client: c.chat(message, temperature=0, max_tokens=1000))
    embedder = embedder_from_env()
    if embedder is None:
        print("embeddings: no API key in the environment", flush=True)
    else:
        embedder.use_cache, embedder.timeout = False, TIMEOUT
        check(f"embeddings {EMBED_MODEL}", lambda: embedder.embed([f"warm-up {nonce}"], EMBED_MODEL))
    warm_radar(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("REUSE_GATE_API_URL", LIVE_API))
    return 0 if ready["primary"] else 1 if ready["fallback"] else 2


if __name__ == "__main__":
    sys.exit(main())
