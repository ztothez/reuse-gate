#!/usr/bin/env python3
"""Wake the live models before a demo, so the first person does not wait for a cold start.

Usage: python3 -I warmup.py
Calls gpt-oss-120b (primary), GLM-5.2 (fallback) and the embedding model once each, bypassing the cache,
with a long timeout. Exit code: 0 primary ready, 1 only the fallback ready, 2 no chat model ready. Never prints keys.
"""
import sys
import time

sys.path.insert(0, ".")
from kpi_match import EMBED_MODEL, embedder_from_env
from llm import LLMError, live_backends, load_env

TIMEOUT = 300


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
        embedder.use_cache = False
        check(f"embeddings {EMBED_MODEL}", lambda: embedder.embed([f"warm-up {nonce}"], EMBED_MODEL))
    return 0 if ready["primary"] else 1 if ready["fallback"] else 2


if __name__ == "__main__":
    sys.exit(main())
