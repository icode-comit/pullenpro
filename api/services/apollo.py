import os, logging
from typing import Any, Dict
import httpx
from .circuit_breaker import breakers

logger   = logging.getLogger("pullenspro")
API_KEY  = os.getenv("APOLLO_API_KEY", "")

async def enrich(lead: Dict[str, Any], client: httpx.AsyncClient) -> Dict:
    """Primary enrichment: person identity, company, phone, LinkedIn."""
    cb = breakers["apollo"]
    if not cb.allow_request():
        raise RuntimeError("Apollo circuit breaker OPEN")
    try:
        payload: Dict[str, Any] = {"api_key": API_KEY}
        for f in ("email", "domain", "first_name", "last_name"):
            if lead.get(f):
                payload[f] = lead[f]
        r = await client.post("https://api.apollo.io/v1/people/match", json=payload, timeout=15)
        r.raise_for_status()
        person = r.json().get("person") or {}
        org    = person.get("organization") or {}
        phones = person.get("phone_numbers") or [{}]
        cb.record_success()
        return {
            "email":        person.get("email"),
            "first_name":   person.get("first_name"),
            "last_name":    person.get("last_name"),
            "full_name":    person.get("name"),
            "job_title":    person.get("title"),
            "linkedin_url": person.get("linkedin_url"),
            "phone":        phones[0].get("sanitized_number"),
            "company":      org.get("name"),
            "domain":       org.get("primary_domain"),
            "company_size": str(org.get("estimated_num_employees") or ""),
            "industry":     org.get("industry"),
            "location":     person.get("city"),
            "enrichment_source": "apollo",
            "confidence_score":  0.88,
        }
    except Exception as exc:
        cb.record_failure()
        logger.error("Apollo error: %s", exc)
        raise
