from fastapi import APIRouter, HTTPException
from ..services.dns_checker import check_domain_health

router = APIRouter(prefix="/domain", tags=["Domain"])

@router.get("/health/{domain}")
async def domain_health(domain: str):
    domain = domain.lower().strip().lstrip("https://").lstrip("http://").lstrip("www.").rstrip("/")
    if not domain:
        raise HTTPException(422, "Invalid domain.")
    return await check_domain_health(domain)
