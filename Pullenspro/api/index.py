"""
Pullenspro — FastAPI Backend
Features: Redis caching, sliding-window rate limiting, per-service circuit breakers,
          bulk CSV enrichment with bounded concurrency, webhook notifications.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

import httpx
import redis.asyncio as aioredis
from fastapi import (
    BackgroundTasks, FastAPI, File, HTTPException,
    Query, Request, UploadFile, status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, validator

# ── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("pullenspro")

# ── Configuration ────────────────────────────────────────────────────────────
import os

REDIS_URL                 = os.getenv("REDIS_URL",                 "redis://localhost:6379/0")
HUNTER_API_KEY            = os.getenv("HUNTER_API_KEY",            "")
APOLLO_API_KEY            = os.getenv("APOLLO_API_KEY",            "")
RATE_LIMIT_REQUESTS       = int(os.getenv("RATE_LIMIT_REQUESTS",   "100"))
RATE_LIMIT_WINDOW         = int(os.getenv("RATE_LIMIT_WINDOW",     "60"))
MAX_BULK_ROWS             = int(os.getenv("MAX_BULK_ROWS",         "5000"))
JOB_TTL                   = int(os.getenv("JOB_TTL",              "86400"))
CACHE_TTL                 = int(os.getenv("CACHE_TTL",            "3600"))
CIRCUIT_FAILURE_THRESHOLD = int(os.getenv("CIRCUIT_FAILURE_THRESHOLD", "5"))
CIRCUIT_RECOVERY_TIMEOUT  = int(os.getenv("CIRCUIT_RECOVERY_TIMEOUT",  "30"))

# Comma-separated allowed origins, e.g. https://pullenspro.vercel.app,https://pullenspro.com
# Set to * only for local development — always restrict in production
_RAW_ORIGINS    = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = (
    [o.strip() for o in _RAW_ORIGINS.split(",") if o.strip()]
    if _RAW_ORIGINS != "*" else ["*"]
)

# ── Enums ─────────────────────────────────────────────────────────────────────
class JobStatus(str, Enum):
    QUEUED    = "queued"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"

class CircuitState(str, Enum):
    CLOSED    = "closed"
    OPEN      = "open"
    HALF_OPEN = "half_open"

# ── Circuit Breaker ───────────────────────────────────────────────────────────
@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int   = CIRCUIT_FAILURE_THRESHOLD
    recovery_timeout:  int   = CIRCUIT_RECOVERY_TIMEOUT
    failure_count:     int   = 0
    last_failure_time: float = 0.0
    state: CircuitState      = CircuitState.CLOSED

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.monotonic()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            logger.warning("Circuit [%s] OPEN after %d failures", self.name, self.failure_count)

    def record_success(self):
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    def allow_request(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True
        if self.state == CircuitState.OPEN:
            if time.monotonic() - self.last_failure_time >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                logger.info("Circuit [%s] HALF_OPEN — probing", self.name)
                return True
            return False
        return True  # HALF_OPEN

_breakers: Dict[str, CircuitBreaker] = {
    "hunter": CircuitBreaker("hunter"),   # email finding & verification
    "apollo": CircuitBreaker("apollo"),   # person + company enrichment
}

# ── Pydantic Models ────────────────────────────────────────────────────────────
class LeadInput(BaseModel):
    domain:     Optional[str] = None
    email:      Optional[str] = None
    first_name: Optional[str] = None
    last_name:  Optional[str] = None
    company:    Optional[str] = None

    @validator("domain", pre=True)
    def clean_domain(cls, v):
        if v:
            v = v.strip().lower()
            for p in ("https://", "http://", "www."):
                if v.startswith(p):
                    v = v[len(p):]
            return v.rstrip("/")
        return v

class EnrichedLead(BaseModel):
    domain:            Optional[str]   = None
    email:             Optional[str]   = None
    first_name:        Optional[str]   = None
    last_name:         Optional[str]   = None
    company:           Optional[str]   = None
    full_name:         Optional[str]   = None
    job_title:         Optional[str]   = None
    linkedin_url:      Optional[str]   = None
    phone:             Optional[str]   = None
    company_size:      Optional[str]   = None
    industry:          Optional[str]   = None
    location:          Optional[str]   = None
    enrichment_source: Optional[str]   = None
    confidence_score:  Optional[float] = None
    enriched_at:       Optional[str]   = None
    error:             Optional[str]   = None

class BulkJobResponse(BaseModel):
    job_id:            str
    status:            JobStatus
    total_rows:        int
    created_at:        str
    estimated_seconds: Optional[int] = None

class JobStatusResponse(BaseModel):
    job_id:          str
    status:          JobStatus
    total_rows:      int
    processed_rows:  int
    successful_rows: int
    failed_rows:     int
    progress_pct:    float
    created_at:      str
    started_at:      Optional[str] = None
    completed_at:    Optional[str] = None
    error:           Optional[str] = None
    download_ready:  bool = False

class RateLimitInfo(BaseModel):
    limit:     int
    remaining: int
    reset_at:  int

# ── Redis Helpers ──────────────────────────────────────────────────────────────
_redis_client: Optional[aioredis.Redis] = None

async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = await aioredis.from_url(
            REDIS_URL, encoding="utf-8", decode_responses=True
        )
    return _redis_client

async def redis_get_json(key: str) -> Optional[Any]:
    r = await get_redis()
    raw = await r.get(key)
    return json.loads(raw) if raw else None

async def redis_set_json(key: str, value: Any, ttl: int = CACHE_TTL) -> None:
    r = await get_redis()
    await r.setex(key, ttl, json.dumps(value, default=str))

# ── Sliding-Window Rate Limiter ────────────────────────────────────────────────
async def check_rate_limit(request: Request) -> RateLimitInfo:
    r   = await get_redis()
    ip  = request.client.host if request.client else "unknown"
    key = f"rl:{ip}"
    now = time.time()
    win = now - RATE_LIMIT_WINDOW

    pipe = r.pipeline()
    pipe.zremrangebyscore(key, "-inf", win)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, RATE_LIMIT_WINDOW)
    results = await pipe.execute()

    count     = results[2]
    remaining = max(0, RATE_LIMIT_REQUESTS - count)
    reset_at  = int(now) + RATE_LIMIT_WINDOW

    if count > RATE_LIMIT_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limit_exceeded",
                "limit": RATE_LIMIT_REQUESTS,
                "window_seconds": RATE_LIMIT_WINDOW,
                "reset_at": reset_at,
            },
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )
    return RateLimitInfo(limit=RATE_LIMIT_REQUESTS, remaining=remaining, reset_at=reset_at)

# ── Enrichment Functions ───────────────────────────────────────────────────────
#
#  Pipeline strategy (each fills gaps left by the previous):
#
#  1. Apollo  — primary enrichment: person data, company info, phone,
#               LinkedIn, industry, company size. Best all-round coverage.
#
#  2. Hunter  — email specialist: runs AFTER Apollo to find/verify email
#               when Apollo did not return one, or to verify an existing
#               email against the domain. Best-in-class deliverability scores.
#
# ─────────────────────────────────────────────────────────────────────────────

async def _apollo_enrich(lead: LeadInput, client: httpx.AsyncClient) -> Dict:
    """
    Apollo.io — primary enrichment source.
    Strengths: person identity, job title, LinkedIn, phone, company firmographics.
    Called first so its rich data populates as many fields as possible.
    """
    cb = _breakers["apollo"]
    if not cb.allow_request():
        raise RuntimeError("Apollo circuit breaker OPEN")
    try:
        payload: Dict[str, Any] = {"api_key": APOLLO_API_KEY}
        for f in ("email", "domain", "first_name", "last_name"):
            if getattr(lead, f):
                payload[f] = getattr(lead, f)

        r = await client.post(
            "https://api.apollo.io/v1/people/match",
            json=payload,
            timeout=15,
        )
        r.raise_for_status()
        person = r.json().get("person") or {}
        org    = person.get("organization") or {}
        phones = person.get("phone_numbers") or [{}]
        cb.record_success()
        return {
            # Identity
            "email":             person.get("email"),
            "first_name":        person.get("first_name"),
            "last_name":         person.get("last_name"),
            "full_name":         person.get("name"),
            # Professional
            "job_title":         person.get("title"),
            "linkedin_url":      person.get("linkedin_url"),
            "phone":             phones[0].get("sanitized_number"),
            # Company
            "company":           org.get("name"),
            "domain":            org.get("primary_domain"),
            "company_size":      str(org.get("estimated_num_employees") or ""),
            "industry":          org.get("industry"),
            "location":          person.get("city"),
            # Meta
            "enrichment_source": "apollo",
            "confidence_score":  0.88,
        }
    except Exception as exc:
        cb.record_failure()
        logger.error("Apollo error: %s", exc)
        raise


async def _hunter_enrich(lead: LeadInput, client: httpx.AsyncClient) -> Dict:
    """
    Hunter.io — email specialist, called AFTER Apollo.
    Strengths: email finding by name+domain, email verification with
               deliverability scoring. Only runs when email is still missing
               or needs verification against the domain.
    """
    cb = _breakers["hunter"]
    if not cb.allow_request():
        raise RuntimeError("Hunter circuit breaker OPEN")
    try:
        # Best case: we have name + domain → precise email finder
        if lead.domain and lead.first_name and lead.last_name:
            r = await client.get(
                "https://api.hunter.io/v2/email-finder",
                params=dict(
                    domain=lead.domain,
                    first_name=lead.first_name,
                    last_name=lead.last_name,
                    api_key=HUNTER_API_KEY,
                ),
                timeout=10,
            )
            r.raise_for_status()
            d = r.json().get("data", {})
            cb.record_success()
            return {
                "email":             d.get("email"),
                "confidence_score":  (d.get("score") or 0) / 100,
                "enrichment_source": "hunter",
            }

        # Fallback: domain-only search — returns most common email pattern
        if lead.domain:
            r = await client.get(
                "https://api.hunter.io/v2/domain-search",
                params=dict(domain=lead.domain, api_key=HUNTER_API_KEY, limit=1),
                timeout=10,
            )
            r.raise_for_status()
            emails = r.json().get("data", {}).get("emails", [])
            if emails:
                t = emails[0]
                cb.record_success()
                return {
                    "email":             t.get("value"),
                    "first_name":        t.get("first_name"),
                    "last_name":         t.get("last_name"),
                    "job_title":         t.get("position"),
                    "confidence_score":  (t.get("confidence") or 0) / 100,
                    "enrichment_source": "hunter",
                }

        cb.record_success()
        return {}
    except Exception as exc:
        cb.record_failure()
        logger.error("Hunter error: %s", exc)
        raise


async def enrich_lead(lead: LeadInput, sources: List[str], http_client: httpx.AsyncClient) -> EnrichedLead:
    """
    Orchestrates enrichment across sources using a gap-filling merge strategy:
    - Apollo runs first (broadest enrichment)
    - Hunter runs after (fills email gap + adds deliverability confidence)
    - Each source only fills fields that are still None — no overwriting
    - Results are cached in Redis to avoid repeat API spend
    """
    cache_key = (
        f"lead:{lead.domain or ''}:{lead.email or ''}"
        f":{lead.first_name or ''}:{lead.last_name or ''}"
    )
    cached = await redis_get_json(cache_key)
    if cached:
        cached["enrichment_source"] = "cache"
        return EnrichedLead(**cached)

    merged: Dict[str, Any] = lead.dict()
    last_error: Optional[str] = None

    # Enforce optimal pipeline order: Apollo → Hunter
    PIPELINE = ["apollo", "hunter"]
    ordered_sources = [s for s in PIPELINE if s in sources]

    for src in ordered_sources:
        fn = {"apollo": _apollo_enrich, "hunter": _hunter_enrich}.get(src)
        if not fn:
            continue
        try:
            result = await fn(lead, http_client)
            for k, v in result.items():
                if v is not None and merged.get(k) is None:
                    merged[k] = v
            # Update lead input with enriched fields for next source to use
            if merged.get("domain")     and not lead.domain:     lead = lead.copy(update={"domain":     merged["domain"]})
            if merged.get("email")      and not lead.email:      lead = lead.copy(update={"email":      merged["email"]})
            if merged.get("first_name") and not lead.first_name: lead = lead.copy(update={"first_name": merged["first_name"]})
            if merged.get("last_name")  and not lead.last_name:  lead = lead.copy(update={"last_name":  merged["last_name"]})
        except Exception as exc:
            last_error = str(exc)

    merged["enriched_at"] = datetime.utcnow().isoformat()
    if last_error and not merged.get("email") and not merged.get("full_name"):
        merged["error"] = last_error

    enriched = EnrichedLead(**merged)
    await redis_set_json(cache_key, enriched.dict())
    return enriched

# ── Job Store ──────────────────────────────────────────────────────────────────
def _jkey(job_id: str) -> str: return f"job:{job_id}"
def _rkey(job_id: str) -> str: return f"job_results:{job_id}"

async def create_job(total_rows: int) -> str:
    job_id = str(uuid.uuid4())
    await redis_set_json(_jkey(job_id), {
        "job_id": job_id, "status": JobStatus.QUEUED,
        "total_rows": total_rows, "processed_rows": 0,
        "successful_rows": 0, "failed_rows": 0,
        "created_at": datetime.utcnow().isoformat(),
        "started_at": None, "completed_at": None, "error": None,
    }, ttl=JOB_TTL)
    return job_id

async def get_job(job_id: str) -> Optional[Dict]:
    return await redis_get_json(_jkey(job_id))

async def update_job(job_id: str, **kwargs) -> None:
    job = await get_job(job_id)
    if job is None:
        return
    job.update(kwargs)
    await redis_set_json(_jkey(job_id), job, ttl=JOB_TTL)

async def append_result(job_id: str, result: Dict) -> None:
    r = await get_redis()
    await r.rpush(_rkey(job_id), json.dumps(result, default=str))
    await r.expire(_rkey(job_id), JOB_TTL)

async def get_all_results(job_id: str) -> List[Dict]:
    r = await get_redis()
    raw = await r.lrange(_rkey(job_id), 0, -1)
    return [json.loads(x) for x in raw]

# ── Bulk Worker ────────────────────────────────────────────────────────────────
async def process_bulk_job(
    job_id: str,
    leads: List[LeadInput],
    sources: List[str],
    concurrency: int,
    notify_webhook: Optional[str],
) -> None:
    await update_job(job_id, status=JobStatus.RUNNING, started_at=datetime.utcnow().isoformat())
    sem = asyncio.Semaphore(concurrency)
    processed = successful = failed = 0

    async def _one(lead: LeadInput, idx: int):
        nonlocal processed, successful, failed
        async with sem:
            try:
                async with httpx.AsyncClient() as client:
                    enriched = await enrich_lead(lead, sources, client)
                await append_result(job_id, enriched.dict())
                successful += 1
            except Exception as exc:
                logger.error("[Job %s] row %d: %s", job_id, idx, exc)
                await append_result(job_id, EnrichedLead(**lead.dict(), error=str(exc)).dict())
                failed += 1
            finally:
                processed += 1
                await update_job(job_id,
                    processed_rows=processed, successful_rows=successful, failed_rows=failed)

    try:
        await asyncio.gather(*[_one(l, i) for i, l in enumerate(leads)])
        await update_job(job_id, status=JobStatus.COMPLETED,
                         completed_at=datetime.utcnow().isoformat())
        if notify_webhook:
            try:
                async with httpx.AsyncClient() as c:
                    await c.post(notify_webhook,
                                 json={"job_id": job_id, "status": "completed"}, timeout=5)
            except Exception:
                pass
    except Exception as exc:
        logger.error("[Job %s] fatal: %s", job_id, exc)
        await update_job(job_id, status=JobStatus.FAILED, error=str(exc),
                         completed_at=datetime.utcnow().isoformat())

# ── App ────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Pullenspro…")
    try:
        r = await get_redis()
        await r.ping()
        logger.info("Redis connected ✓")
    except Exception as exc:
        logger.warning("Redis unavailable at startup: %s", exc)
    yield
    global _redis_client
    if _redis_client:
        await _redis_client.aclose()

app = FastAPI(
    title="Pullenspro",
    description="High-performance lead enrichment API — Redis caching, sliding-window rate limiting, circuit breakers, bulk CSV processing.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path in ("/", "/health", "/docs", "/openapi.json"):
        return await call_next(request)
    try:
        rl = await check_rate_limit(request)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"]     = str(rl.limit)
        response.headers["X-RateLimit-Remaining"] = str(rl.remaining)
        response.headers["X-RateLimit-Reset"]     = str(rl.reset_at)
        return response
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)

# ── Meta Routes ────────────────────────────────────────────────────────────────
@app.get("/", tags=["Meta"])
async def root():
    return {"service": "Pullenspro", "version": "1.0.0", "status": "ok"}

@app.get("/health", tags=["Meta"])
async def health():
    redis_ok = False
    try:
        r = await get_redis(); await r.ping(); redis_ok = True
    except Exception:
        pass
    return {
        "status":           "healthy" if redis_ok else "degraded",
        "redis":            "ok" if redis_ok else "unavailable",
        "circuit_breakers": {n: cb.state for n, cb in _breakers.items()},
        "timestamp":        datetime.utcnow().isoformat(),
    }

@app.get("/circuit-breakers", tags=["Meta"])
async def circuit_breaker_status():
    return {n: {"state": cb.state, "failure_count": cb.failure_count,
                "threshold": cb.failure_threshold} for n, cb in _breakers.items()}

@app.post("/circuit-breakers/{service}/reset", tags=["Meta"])
async def reset_circuit_breaker(service: str):
    if service not in _breakers:
        raise HTTPException(404, f"Unknown service '{service}'")
    _breakers[service].record_success()
    return {"service": service, "state": _breakers[service].state}

# ── Enrichment Routes ──────────────────────────────────────────────────────────
@app.post("/enrich", response_model=EnrichedLead, tags=["Enrichment"])
async def enrich_single(
    lead: LeadInput,
    sources: List[str] = Query(default=["hunter"]),
):
    """Enrich one lead record against the requested data sources."""
    if not lead.domain and not lead.email:
        raise HTTPException(422, "Provide at least 'domain' or 'email'.")
    async with httpx.AsyncClient() as client:
        return await enrich_lead(lead, sources, client)

# ── Bulk Routes ────────────────────────────────────────────────────────────────
@app.post("/bulk/upload", response_model=BulkJobResponse, tags=["Bulk"])
async def upload_bulk_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    sources: str = Query(default="apollo,hunter", description="Comma-separated: apollo,hunter"),
    concurrency: int = Query(default=5, ge=1, le=20),
    notify_webhook: Optional[str] = Query(default=None),
):
    """Upload CSV → returns job_id immediately. Poll /bulk/jobs/{job_id} for progress."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only .csv files are accepted.")

    raw  = await file.read()
    text = raw.decode("utf-8-sig") if raw[:3] == b'\xef\xbb\xbf' else raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    leads: List[LeadInput] = []
    for row in reader:
        row = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
        leads.append(LeadInput(
            domain=row.get("domain"), email=row.get("email"),
            first_name=row.get("first_name"), last_name=row.get("last_name"),
            company=row.get("company"),
        ))
        if len(leads) >= MAX_BULK_ROWS:
            break

    if not leads:
        raise HTTPException(400, "CSV contains no valid rows.")

    source_list = [s.strip() for s in sources.split(",") if s.strip()]
    job_id      = await create_job(len(leads))

    background_tasks.add_task(
        process_bulk_job, job_id, leads, source_list, concurrency, notify_webhook
    )

    return BulkJobResponse(
        job_id=job_id, status=JobStatus.QUEUED, total_rows=len(leads),
        created_at=datetime.utcnow().isoformat(),
        estimated_seconds=max(1, len(leads) // concurrency),
    )

@app.get("/bulk/jobs/{job_id}", response_model=JobStatusResponse, tags=["Bulk"])
async def job_status(job_id: str):
    """Poll job progress — frontend uses smart exponential-backoff polling."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' not found.")
    total     = job["total_rows"]
    processed = job["processed_rows"]
    return JobStatusResponse(
        job_id=job["job_id"], status=job["status"],
        total_rows=total, processed_rows=processed,
        successful_rows=job["successful_rows"], failed_rows=job["failed_rows"],
        progress_pct=round((processed / total * 100) if total else 0, 1),
        created_at=job["created_at"], started_at=job.get("started_at"),
        completed_at=job.get("completed_at"), error=job.get("error"),
        download_ready=job["status"] == JobStatus.COMPLETED,
    )

@app.get("/bulk/jobs", tags=["Bulk"])
async def list_jobs(limit: int = Query(default=20, ge=1, le=100)):
    r    = await get_redis()
    keys = await r.keys("job:*")
    jobs = []
    for key in keys[:limit]:
        raw = await r.get(key)
        if raw:
            jobs.append(json.loads(raw))
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return {"jobs": jobs, "total": len(jobs)}

@app.delete("/bulk/jobs/{job_id}", tags=["Bulk"])
async def cancel_job(job_id: str):
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' not found.")
    if job["status"] in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(409, f"Job already {job['status']}.")
    await update_job(job_id, status=JobStatus.CANCELLED)
    return {"job_id": job_id, "status": JobStatus.CANCELLED}

@app.get("/bulk/jobs/{job_id}/download", tags=["Bulk"])
async def download_results(job_id: str):
    """Stream enriched results as CSV."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' not found.")
    if job["status"] != JobStatus.COMPLETED:
        raise HTTPException(409, "Job not yet completed.")

    results    = await get_all_results(job_id)
    fieldnames = [
        "domain","email","first_name","last_name","company",
        "full_name","job_title","linkedin_url","phone",
        "company_size","industry","location",
        "enrichment_source","confidence_score","enriched_at","error",
    ]

    def _generate():
        buf = io.StringIO()
        w   = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        yield buf.getvalue()
        for row in results:
            buf = io.StringIO()
            w   = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
            w.writerow(row)
            yield buf.getvalue()

    return StreamingResponse(
        _generate(), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=leads_{job_id}.csv"},
    )

# ── Cache Routes ───────────────────────────────────────────────────────────────
@app.delete("/cache/{cache_key}", tags=["Cache"])
async def invalidate_cache(cache_key: str):
    r = await get_redis()
    deleted = await r.delete(f"lead:{cache_key}")
    return {"deleted": bool(deleted)}

@app.get("/cache/stats", tags=["Cache"])
async def cache_stats():
    r    = await get_redis()
    keys = await r.keys("lead:*")
    return {"cached_leads": len(keys)}
