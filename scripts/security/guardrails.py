#!/usr/bin/env python3
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SECRET_KEY_RE = re.compile(
    r"(?i)(SECRET|TOKEN|API[_-]?KEY|PASSWORD|PASSWD|PRIVATE[_-]?KEY|AUTH|ENCRYPT|SALT|ACCESS[_-]?KEY|REFRESH[_-]?TOKEN)"
)

ENV_FILE_RE = re.compile(r"(^|/)\.env(\.|$)", re.IGNORECASE)
ENV_ALLOWLIST_RE = re.compile(
    r"(?i)\.env\.(example|sample|template|tmpl|nas\.template|local\.example|test\.example|production\.example)$"
)

ASSIGNMENT_PATTERNS = [
    re.compile(r"^\s*-?\s*([A-Za-z0-9_.-]+)\s*=\s*(.+)$"),
    re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$"),
]

ALLOWED_LITERAL_RE = re.compile(
    r"(?i)^(changeme|change_me|your[_-]?.*|example|placeholder|replace|todo|tbd|dummy|test|local|dev|development|secret|salt|client_secret|client_id|<.*>|\*+)$"
)

SENSITIVE_PATHS = [
    re.compile(r"^deploy/.*\.(ya?ml)$", re.IGNORECASE),
    re.compile(r"^docker-compose.*\.(ya?ml)$", re.IGNORECASE),
    re.compile(r"^\.github/workflows/.*\.(ya?ml)$", re.IGNORECASE),
]

MIGRATIONS_GLOB = "apps/web/prisma/migrations/**/*.sql"

STRING_LITERAL_RE = re.compile(r"'([^']{20,})'")
BASE64_RE = re.compile(r"^[A-Za-z0-9+/=]+$")
HEX_RE = re.compile(r"^[a-fA-F0-9]+$")
NON_SECRET_KEYS = {"id-token"}


def shannon_entropy(value: str) -> float:
    counts = {}
    for ch in value:
        counts[ch] = counts.get(ch, 0) + 1
    entropy = 0.0
    for count in counts.values():
        p = count / len(value)
        entropy -= p * math.log2(p)
    return entropy


def git_ls_files(root: Path):
    try:
        output = subprocess.check_output(
            ["git", "-C", str(root), "ls-files", "-z"], text=True
        )
    except Exception:
        return []
    return [Path(root, p) for p in output.split("\0") if p]


def is_sensitive_path(rel_path: str) -> bool:
    return any(pattern.search(rel_path) for pattern in SENSITIVE_PATHS)


def is_allowed_value(value: str) -> bool:
    if not value:
        return True
    if "${" in value or "${{" in value:
        return True
    if value.startswith("$"):
        return True
    lowered = value.lower()
    if "secrets." in lowered or "env." in lowered:
        return True
    if ALLOWED_LITERAL_RE.match(value):
        return True
    return False


def check_tracked_env_files(files):
    issues = []
    for path in files:
        rel = str(path.relative_to(ROOT))
        if ENV_FILE_RE.search(rel) and not ENV_ALLOWLIST_RE.search(rel):
            issues.append(rel)
    return issues


def check_sensitive_assignments(files):
    issues = []
    for path in files:
        rel = str(path.relative_to(ROOT))
        if not is_sensitive_path(rel):
            continue
        try:
            lines = path.read_text(errors="ignore").splitlines()
        except Exception:
            continue
        for line_no, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            for pattern in ASSIGNMENT_PATTERNS:
                match = pattern.match(line)
                if not match:
                    continue
                key, value = match.group(1), match.group(2).strip()
                if key.lower() in NON_SECRET_KEYS:
                    break
                if not SECRET_KEY_RE.search(key):
                    continue
                if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
                    value = value[1:-1].strip()
                if not is_allowed_value(value):
                    issues.append((rel, line_no, key))
                break
    return issues


def check_migrations():
    issues = []
    migration_files = list(ROOT.glob(MIGRATIONS_GLOB))
    if not migration_files:
        return issues
    for path in migration_files:
        try:
            lines = path.read_text(errors="ignore").splitlines()
        except Exception:
            continue
        for line_no, line in enumerate(lines, start=1):
            for match in STRING_LITERAL_RE.finditer(line):
                literal = match.group(1)
                entropy = shannon_entropy(literal)
                is_hex = bool(HEX_RE.match(literal))
                is_b64 = bool(BASE64_RE.match(literal))
                if (is_hex or is_b64) and entropy >= 3.5 and len(literal) >= 24:
                    rel = str(path.relative_to(ROOT))
                    issues.append((rel, line_no, len(literal)))
    return issues


def main():
    files = git_ls_files(ROOT)
    if not files:
        print("Guardrails: unable to list git files.")
        return 1

    env_issues = check_tracked_env_files(files)
    assignment_issues = check_sensitive_assignments(files)
    migration_issues = check_migrations()

    if not (env_issues or assignment_issues or migration_issues):
        print("Guardrails: OK")
        return 0

    print("Guardrails: issues detected")
    if env_issues:
        print("- Tracked env files (should not be committed):")
        for rel in env_issues:
            print(f"  - {rel}")
    if assignment_issues:
        print("- Literal secret-like values in config files:")
        for rel, line_no, key in assignment_issues:
            print(f"  - {rel}:{line_no} [{key}]")
    if migration_issues:
        print("- Suspicious long literals in migrations:")
        for rel, line_no, length in migration_issues:
            print(f"  - {rel}:{line_no} [len:{length}]")
    return 1


if __name__ == "__main__":
    sys.exit(main())
