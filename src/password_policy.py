"""Password rules:

- 8 to 128 characters, with at least one capital letter, one number and one
  special character (the project's chosen rule);
- and, as NIST SP 800-63B-4 recommends, refuse commonly used, expected or
  compromised values: the 10,000 most common passwords
  (data/common_passwords.txt, SecLists, MIT licence), those padded out with
  digits or symbols, runs and sequences, and words tied to this service or
  the person.

Returns a plain-language reason, or None when the password is acceptable.
"""
import re
from functools import lru_cache
from pathlib import Path

MIN_LENGTH = 8
MAX_LENGTH = 128
SERVICE_WORDS = ("freightwise", "sail", "coking", "password")
COMMON_FILE = Path(__file__).resolve().parent.parent / "data" / "common_passwords.txt"


@lru_cache(maxsize=1)
def _common() -> frozenset[str]:
    if not COMMON_FILE.exists():
        return frozenset()
    return frozenset(line.strip().lower() for line in COMMON_FILE.read_text().splitlines() if line.strip())


def _is_sequence(s: str) -> bool:
    """Runs such as 'aaaaaaaaaaaaaaa' or '123456789012345' / 'abcdefghijklmno'."""
    if len(set(s)) <= 2:
        return True
    diffs = {ord(b) - ord(a) for a, b in zip(s, s[1:])}
    return diffs <= {1, -9} or diffs <= {-1, 9}


def _is_repeat(s: str) -> bool:
    """The same chunk over and over, e.g. 'abcabcabcabcabc'."""
    return any(len(s) % n == 0 and s[:n] * (len(s) // n) == s for n in range(1, len(s) // 2 + 1))


def missing_rules(password: str) -> list[str]:
    """Which of the composition rules the password doesn't meet yet."""
    missing = []
    if len(password) < MIN_LENGTH:
        missing.append(f"at least {MIN_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        missing.append("a capital letter")
    if not re.search(r"\d", password):
        missing.append("a number")
    if not re.search(r"[^A-Za-z0-9]", password):
        missing.append("a special character")
    return missing


def check_password(password: str, email: str = "", name: str = "") -> str | None:
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    missing = missing_rules(password)
    if missing:
        listed = missing[0] if len(missing) == 1 else ", ".join(missing[:-1]) + " and " + missing[-1]
        return f"Your password needs {listed}."
    lowered = password.lower()
    letters = re.sub(r"[^a-z]", "", lowered)
    compact = re.sub(r"\s+", "", lowered)
    common = _common()
    if compact in common or letters in common:
        return "This password is too common. Choose something others wouldn't guess."
    stripped = re.sub(r"[\d\W_]+$", "", re.sub(r"^[\W_]+", "", compact))
    if stripped in common or (stripped and _is_repeat(stripped) and stripped[: len(stripped) // 2] in common):
        return "This is a common password with extra characters. Choose something others wouldn't guess."
    if _is_sequence(compact) or _is_repeat(compact):
        return "Avoid repeated characters and sequences."
    local = email.split("@")[0].lower()
    parts = re.split(r"[^a-z0-9]+", f"{local} {name.lower()}")
    # Each name part, and the name and email name run together ("asharao").
    personal = {p for p in parts if len(p) >= 4} | {re.sub(r"[^a-z]", "", local), re.sub(r"[^a-z]", "", name.lower())}
    without_digits = re.sub(r"\d", "", compact)
    for word in {*SERVICE_WORDS, *personal}:
        if len(word) >= 4 and word in compact and len(re.sub(r"[\W_]", "", without_digits)) - len(word) < 4:
            return "Don't build the password around your name, email or this service's name."
    return None
