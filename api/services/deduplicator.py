import re
from typing import List, Dict, Tuple

ROLE_ACCOUNTS = {
    "info", "contact", "admin", "support", "help", "sales",
    "hello", "noreply", "no-reply", "postmaster", "webmaster",
    "team", "hr", "careers", "jobs", "marketing", "billing",
    "office", "mail", "enquiries", "enquiry", "service",
}

def is_role_based(email: str) -> bool:
    local = email.lower().split("@")[0] if "@" in email else email.lower()
    return local in ROLE_ACCOUNTS

def normalise_email(email: str) -> str:
    email = email.lower().strip()
    if "@" not in email:
        return email
    local, domain = email.split("@", 1)
    local = local.split("+")[0]           # strip +tags
    local = local.replace(".", "")        # gmail dot trick
    return f"{local}@{domain}"

def deduplicate(rows: List[Dict], email_field: str = "email") -> Tuple[List[Dict], int]:
    """
    Remove duplicates within a list. Returns (clean_list, duplicate_count).
    Uses normalised email for comparison to catch dot/tag variants.
    """
    seen:  set = set()
    clean: List[Dict] = []
    dupes = 0
    for row in rows:
        email = row.get(email_field, "")
        key   = normalise_email(email) if email else str(row)
        if key in seen:
            dupes += 1
        else:
            seen.add(key)
            clean.append(row)
    return clean, dupes

def detect_role_emails(rows: List[Dict], email_field: str = "email") -> Tuple[List[Dict], int]:
    """Flag role-based emails. Returns (annotated_rows, role_count)."""
    role_count = 0
    for row in rows:
        email = row.get(email_field, "")
        if is_role_based(email):
            row["_role_based"] = True
            role_count += 1
        else:
            row["_role_based"] = False
    return rows, role_count
