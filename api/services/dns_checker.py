import asyncio, logging, os
from typing import Any, Dict, List

logger = logging.getLogger("pullenspro")

# Public DNS blacklist zones to check
BLACKLISTS = [
    "zen.spamhaus.org",
    "b.barracudacentral.org",
    "bl.spamcop.net",
    "dnsbl.sorbs.net",
]

async def check_domain_health(domain: str) -> Dict[str, Any]:
    """
    Full domain health check: MX, SPF, DKIM, DMARC, blacklist.
    Uses dnspython (sync wrapped in asyncio executor).
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_check, domain)

def _sync_check(domain: str) -> Dict[str, Any]:
    try:
        import dns.resolver
        resolver = dns.resolver.Resolver()
        resolver.nameservers = ["8.8.8.8", "1.1.1.1"]
        resolver.lifetime    = float(os.getenv("DNS_TIMEOUT", "5"))
    except ImportError:
        return _fallback(domain)

    results: Dict[str, Any] = {"domain": domain}

    # MX
    try:
        mx_records = resolver.resolve(domain, "MX")
        results["mx"] = {
            "valid":   True,
            "records": [str(r.exchange).rstrip(".") for r in mx_records],
        }
    except Exception:
        results["mx"] = {"valid": False, "records": []}

    # SPF
    try:
        txt_records = resolver.resolve(domain, "TXT")
        spf = next((str(r) for r in txt_records if "v=spf1" in str(r).lower()), None)
        results["spf"] = {"valid": spf is not None, "record": spf}
    except Exception:
        results["spf"] = {"valid": False, "record": None}

    # DMARC
    try:
        dmarc_records = resolver.resolve(f"_dmarc.{domain}", "TXT")
        dmarc = next((str(r) for r in dmarc_records if "v=DMARC1" in str(r)), None)
        policy = None
        if dmarc:
            for part in dmarc.split(";"):
                if part.strip().startswith("p="):
                    policy = part.strip()[2:]
        results["dmarc"] = {"valid": dmarc is not None, "policy": policy}
    except Exception:
        results["dmarc"] = {"valid": False, "policy": None}

    # DKIM (check default selector)
    try:
        resolver.resolve(f"default._domainkey.{domain}", "TXT")
        results["dkim"] = {"valid": True}
    except Exception:
        results["dkim"] = {"valid": False}

    # Blacklist check
    listed_on: List[str] = []
    try:
        import ipaddress
        a_records = resolver.resolve(domain, "A")
        ip = str(a_records[0])
        rev = ".".join(reversed(ip.split(".")))
        for bl in BLACKLISTS:
            try:
                resolver.resolve(f"{rev}.{bl}", "A")
                listed_on.append(bl)
            except Exception:
                pass
    except Exception:
        pass

    results["spam_score"] = {"listed": len(listed_on) > 0, "lists": listed_on}

    # Overall
    passes = [
        results["mx"]["valid"],
        results["spf"]["valid"],
        results["dmarc"]["valid"],
        not results["spam_score"]["listed"],
    ]
    failed = passes.count(False)
    results["overall"] = "healthy" if failed == 0 else "warning" if failed <= 1 else "critical"

    return results

def _fallback(domain: str) -> Dict[str, Any]:
    """Return empty structure if dnspython not installed."""
    return {
        "domain": domain,
        "mx":         {"valid": False, "records": []},
        "spf":        {"valid": False, "record": None},
        "dmarc":      {"valid": False, "policy": None},
        "dkim":       {"valid": False},
        "spam_score": {"listed": False, "lists": []},
        "overall":    "unknown",
        "error":      "dnspython not installed",
    }
