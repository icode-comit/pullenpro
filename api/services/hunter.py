import os, logging
from typing import Any, Dict
import httpx
from .circuit_breaker import breakers

logger  = logging.getLogger("pullenspro")
API_KEY = os.getenv("HUNTER_API_KEY", "")

async def enrich(lead: Dict[str, Any], client: httpx.AsyncClient) -> Dict:
    """Email specialist: find or verify email via name+domain or domain-only."""
    cb = breakers["hunter"]
    if not cb.allow_request():
        raise RuntimeError("Hunter circuit breaker OPEN")
    try:
        if lead.get("domain") and lead.get("first_name") and lead.get("last_name"):
            r = await client.get(
                "https://api.hunter.io/v2/email-finder",
                params=dict(domain=lead["domain"], first_name=lead["first_name"],
                            last_name=lead["last_name"], api_key=API_KEY),
                timeout=10,
            )
            r.raise_for_status()
            d = r.json().get("data", {})
            cb.record_success()
            return {"email": d.get("email"),
                    "confidence_score": (d.get("score") or 0) / 100,
                    "enrichment_source": "hunter"}
        if lead.get("domain"):
            r = await client.get(
                "https://api.hunter.io/v2/domain-search",
                params=dict(domain=lead["domain"], api_key=API_KEY, limit=1),
                timeout=10,
            )
            r.raise_for_status()
            emails = r.json().get("data", {}).get("emails", [])
            if emails:
                t = emails[0]
                cb.record_success()
                return {"email": t.get("value"), "first_name": t.get("first_name"),
                        "last_name": t.get("last_name"), "job_title": t.get("position"),
                        "confidence_score": (t.get("confidence") or 0) / 100,
                        "enrichment_source": "hunter"}
        cb.record_success()
        return {}
    except Exception as exc:
        cb.record_failure()
        logger.error("Hunter error: %s", exc)
        raise
