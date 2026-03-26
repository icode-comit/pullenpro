import os, logging
from typing import Any, Dict
import httpx
from .circuit_breaker import breakers

logger  = logging.getLogger("pullenspro")
API_KEY = os.getenv("ZEROBOUNCE_API_KEY", "")

# ZeroBounce status → our internal status
STATUS_MAP = {
    "valid":       "valid",
    "invalid":     "invalid",
    "catch-all":   "risky",
    "unknown":     "unknown",
    "spamtrap":    "invalid",
    "abuse":       "invalid",
    "do_not_mail": "invalid",
}

async def verify(email: str, client: httpx.AsyncClient) -> Dict[str, Any]:
    """
    7-tier email verification via ZeroBounce API.
    Covers: syntax, DNS/MX, domain existence, catch-all, role-based,
            disposable provider, SMTP verification + greylisting bypass.
    No raw SMTP ports required — ZeroBounce handles that server-side.
    """
    cb = breakers["zerobounce"]
    if not cb.allow_request():
        raise RuntimeError("ZeroBounce circuit breaker OPEN")
    try:
        r = await client.get(
            "https://api.zerobounce.net/v2/validate",
            params={"api_key": API_KEY, "email": email},
            timeout=20,
        )
        r.raise_for_status()
        data   = r.json()
        status = STATUS_MAP.get(data.get("status", "unknown"), "unknown")
        cb.record_success()
        return {
            "email":  email,
            "status": status,
            "score":  _score(data),
            "reason": data.get("sub_status") or data.get("status"),
            "checks": {
                "syntax":       data.get("status") != "invalid" or data.get("sub_status") != "mailbox_not_found",
                "mx_found":     data.get("mx_found") == "true",
                "smtp_provider": data.get("smtp_provider", ""),
                "catch_all":    data.get("catch_all") == "true",
                "role_based":   data.get("account", "").lower() in ROLE_ACCOUNTS,
                "disposable":   data.get("disposable") == "true",
                "free_email":   data.get("free_email") == "true",
            },
        }
    except Exception as exc:
        cb.record_failure()
        logger.error("ZeroBounce error: %s", exc)
        raise

def _score(data: Dict) -> int:
    s = data.get("status", "")
    if s == "valid":     return 95
    if s == "catch-all": return 55
    if s == "unknown":   return 30
    return 0

ROLE_ACCOUNTS = {
    "info", "contact", "admin", "support", "help", "sales",
    "hello", "noreply", "no-reply", "postmaster", "webmaster",
    "team", "hr", "careers", "jobs", "marketing", "billing",
}
