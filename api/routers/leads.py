from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services import apollo
import os

router  = APIRouter(prefix="/leads", tags=["Leads"])
API_KEY = os.getenv("APOLLO_API_KEY", "")

class LeadFilter(BaseModel):
    domain:       Optional[str] = None
    first_name:   Optional[str] = None
    last_name:    Optional[str] = None
    email:        Optional[str] = None
    job_title:    Optional[str] = None
    industry:     Optional[str] = None
    location:     Optional[str] = None
    company_size: Optional[str] = None
    seniority:    Optional[str] = None

@router.post("/search")
async def search_leads(filters: LeadFilter):
    async with httpx.AsyncClient() as client:
        try:
            payload = {
                "api_key": API_KEY,
                "page":    1,
                "per_page": 25,
            }
            if filters.job_title:    payload["person_titles"]    = [filters.job_title]
            if filters.industry:     payload["organization_industry_tag_ids"] = [filters.industry]
            if filters.location:     payload["person_locations"] = [filters.location]
            if filters.seniority:    payload["person_seniorities"] = [filters.seniority]
            if filters.company_size: payload["organization_num_employees_ranges"] = [filters.company_size]
            if filters.domain:       payload["q_organization_domains"] = filters.domain

            r = await client.post(
                "https://api.apollo.io/v1/mixed_people/search",
                json=payload, timeout=15,
            )
            r.raise_for_status()
            people = r.json().get("people", [])
            leads  = []
            for p in people:
                org = p.get("organization") or {}
                leads.append({
                    "email":        p.get("email"),
                    "first_name":   p.get("first_name"),
                    "last_name":    p.get("last_name"),
                    "full_name":    p.get("name"),
                    "job_title":    p.get("title"),
                    "linkedin_url": p.get("linkedin_url"),
                    "company":      org.get("name"),
                    "industry":     org.get("industry"),
                    "location":     p.get("city"),
                    "company_size": str(org.get("estimated_num_employees") or ""),
                    "confidence_score": 0.85,
                })
            return {"leads": leads, "total": len(leads)}
        except Exception as exc:
            raise HTTPException(502, f"Lead search failed: {exc}")

@router.post("/company-search")
async def company_search(domain: str):
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                "https://api.apollo.io/v1/organizations/enrich",
                json={"api_key": API_KEY, "domain": domain},
                timeout=15,
            )
            r.raise_for_status()
            return r.json().get("organization", {})
        except Exception as exc:
            raise HTTPException(502, f"Company search failed: {exc}")
