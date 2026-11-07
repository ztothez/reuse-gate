#!/usr/bin/env python3
"""Regex secret scan of the tracked files and the whole git history. Prints where, never what.

Usage: python3 -I scripts/secret_scan.py [repo]      exit 1 if anything is found
Use gitleaks or trufflehog when they are installed; this is the fallback. Untracked files such as .env are not read.
"""
import re
import subprocess
import sys

RULES = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    "sk- or sk_ key": re.compile(r"\bsk[-_](?:proj-)?[A-Za-z0-9]{20,}"),
    "Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "JWT": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "key assigned a literal": re.compile(r"(?i)(?:api[_-]?key|secret|token|password|passwd|xi-api-key)[\"']?\s*[:=]\s*[\"']([A-Za-z0-9_\-./+=]{20,})[\"']"),
}
ALLOWED = re.compile(r"(?i)^(fake|test|dummy|example|placeholder|changeme|your)[-_]|example|\{|\$")  # test values and templates
SKIP = (".png", ".jpg", ".ico", ".db", ".xlsx", ".mp3", ".webm", ".zip", ".woff", ".woff2", "package-lock.json")


def hits(line):
    for rule, pattern in RULES.items():
        for m in pattern.finditer(line):
            value = m.group(1) if m.groups() else m.group(0)
            if not ALLOWED.search(value):
                yield rule, len(value)


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors="replace").stdout


def scan(repo="."):
    findings = []
    files = [f for f in run(["git", "ls-files"], repo).splitlines() if not f.endswith(SKIP)]
    for path in files:
        try:
            text = open(f"{repo}/{path}", encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            findings += [("tracked", f"{path}:{n}", rule, size) for rule, size in hits(line)]
    commit = path = None
    for line in run(["git", "log", "-p", "--all", "--no-color", "--no-ext-diff", "-U0"], repo).splitlines():
        if line.startswith("commit "):
            commit = line.split()[1][:10]
        elif line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and not line.startswith("+++") and path and not path.endswith(SKIP):
            findings += [("history", f"{commit} {path}", rule, size) for rule, size in hits(line[1:])]
    commits = len(run(["git", "rev-list", "--all"], repo).split())
    return findings, len(files), commits


def main(argv=None):
    repo = (argv or sys.argv[1:] or ["."])[0]
    findings, files, commits = scan(repo)
    for where, place, rule, size in sorted(set(findings)):
        print(f"{where}: {place}: {rule} ({size} characters, value not shown)")
    print(f"{len(set(findings))} finding(s) in {files} tracked files and {commits} commits")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
