"""
Pullenspro — FastAPI Backend v2.0
Modular architecture: routers handle HTTP, services handle logic.
Features: 7-tier email verification (ZeroBounce), domain health (DNS),
          lead search (Apollo), email finding (Hunter), permutation engine,
          list hygiene, Redis caching, sliding-window rate limiting,
          circuit breakers, bulk CSV processing with bounded concurrency.
"""
from __future__ import annotations
import asyncio, csv, io, json, logging, os, time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import (BackgroundTasks, FastAPI, File, HTTPException,
                     Query, Request, UploadFile, status)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, validator

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("pullenspro")

# ── Config ───────────────────────────────────────────────────────────────────
REDIS_URL           = os.getenv("REDIS_URL",           "redis://localhost:6379/0")
HUNTER_API_KEY      = os.getenv("HUNTER_API_KEY",      "")
APOLLO_API_KEY      = os.getenv("APOLLO_API_KEY",      "")
ZEROBOUNCE_API_KEY  = os.getenv("ZEROBOUNCE_API_KEY",  "")
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW   = int(os.getenv("RATE_LIMIT_WINDOW",   "60"))
MAX_BULK_ROWS       = int(os.getenv("MAX_BULK_ROWS",       "5000"))
JOB_TTL             = int(os.getenv("JOB_TTL",            "86400"))
CACHE_TTL           = int(os.getenv("CACHE_TTL",          "3600"))

_RAW_ORIGINS    = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = (
    [o.strip() for o in _RAW_ORIGINS.split(",") if o.strip()]
    if _RAW_ORIGINS != "*" else ["*"]
)

# ── Import services & routers ─────────────────────────────────────────────────
from api.services.redis           import get_redis, redis_get, redis_set
from api.services.circuit_breaker import breakers, CircuitState
from api.services.rate_limiter    import check_rate_limit, RateLimitInfo
from api.services.job_store       import (create_job, get_job, update_job,
                                          append_result, get_all_results, list_jobs)
from api.services                 import apollo as apollo_svc
from api.services                 import hunter as hunter_svc
from api.routers                  import verification, domain, leads, permutation, hygiene

# ── Models ────────────────────────────────────────────────────────────────────
from enum import Enum

class JobStatus(str, Enum):
    QUEUED    = "queued"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"

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
            for p in ("https://","http://","www."):
                if v.startswith(p): v = v[len(p):]
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

# ── Enrichment pipeline ───────────────────────────────────────────────────────
async def enrich_lead(lead: LeadInput, sources: List[str],
                      http_client: httpx.AsyncClient) -> EnrichedLead:
    cache_key = f"lead:{lead.domain or ''}:{lead.email or ''}:{lead.first_name or ''}:{lead.last_name or ''}"
    cached    = await redis_get(cache_key)
    if cached:
        cached["enrichment_source"] = "cache"
        return EnrichedLead(**cached)

    merged: Dict[str, Any] = lead.dict()
    last_error: Optional[str] = None

    PIPELINE = ["apollo", "hunter"]
    for src in [s for s in PIPELINE if s in sources]:
        fn = {"apollo": apollo_svc.enrich, "hunter": hunter_svc.enrich}.get(src)
        if not fn: continue
        try:
            result = await fn(merged, http_client)
            for k, v in result.items():
                if v is not None and merged.get(k) is None:
                    merged[k] = v
        except Exception as exc:
            last_error = str(exc)

    merged["enriched_at"] = datetime.utcnow().isoformat()
    if last_error and not merged.get("email") and not merged.get("full_name"):
        merged["error"] = last_error

    enriched = EnrichedLead(**merged)
    await redis_set(cache_key, enriched.dict())
    return enriched

# ── Bulk job processor ────────────────────────────────────────────────────────
async def process_bulk_job(job_id: str, leads: List[LeadInput],
                           sources: List[str], concurrency: int,
                           notify_webhook: Optional[str]):
    await update_job(job_id, status="running", started_at=datetime.utcnow().isoformat())
    sem = asyncio.Semaphore(concurrency)

    async def _enrich_one(lead: LeadInput):
        job = await get_job(job_id)
        if job and job.get("status") == "cancelled": return
        async with sem:
            async with httpx.AsyncClient() as client:
                try:
                    result = await enrich_lead(lead, sources, client)
                    await append_result(job_id, result.dict())
                    job = await get_job(job_id)
                    if job:
                        await update_job(job_id,
                            status="running",
                            processed_rows=job["processed_rows"] + 1,
                            successful_rows=job["successful_rows"] + 1)
                except Exception as exc:
                    await append_result(job_id, {**lead.dict(), "error": str(exc)})
                    job = await get_job(job_id)
                    if job:
                        await update_job(job_id,
                            status="running",
                            processed_rows=job["processed_rows"] + 1,
                            failed_rows=job["failed_rows"] + 1)

    await asyncio.gather(*[_enrich_one(lead) for lead in leads])
    job = await get_job(job_id)
    if job and job.get("status") != "cancelled":
        await update_job(job_id, status="completed", completed_at=datetime.utcnow().isoformat())
    if notify_webhook:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(notify_webhook, json=await get_job(job_id), timeout=10)
        except Exception: pass

# ── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        r = await get_redis(); await r.ping()
        logger.info("Redis connected ✓")
    except Exception as exc:
        logger.warning("Redis unavailable at startup: %s", exc)
    yield
    from api.services.redis import close
    await close()

app = FastAPI(
    title="Pullenspro",
    description="High-performance lead enrichment & email verification API.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET","POST","DELETE","OPTIONS"],
    allow_headers=["Content-Type","Authorization","X-Requested-With"],
    expose_headers=["X-RateLimit-Limit","X-RateLimit-Remaining","X-RateLimit-Reset"],
)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path in ("/","/health","/docs","/openapi.json"):
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

# ── Mount routers ─────────────────────────────────────────────────────────────
app.include_router(verification.router)
app.include_router(domain.router)
app.include_router(leads.router)
app.include_router(permutation.router)
app.include_router(hygiene.router)

# ── Meta routes ───────────────────────────────────────────────────────────────
@app.get("/", tags=["Meta"])
async def root():
    return {"service": "Pullenspro", "version": "2.0.0", "status": "ok"}

@app.get("/health", tags=["Meta"])
async def health():
    redis_ok = False
    try:
        r = await get_redis(); await r.ping(); redis_ok = True
    except Exception: pass
    return {
        "status":           "healthy" if redis_ok else "degraded",
        "redis":            "ok" if redis_ok else "unavailable",
        "circuit_breakers": {n: cb.state for n, cb in breakers.items()},
        "timestamp":        datetime.utcnow().isoformat(),
    }

@app.get("/circuit-breakers", tags=["Meta"])
async def circuit_breaker_status():
    return {n: {"state": cb.state, "failure_count": cb.failure_count,
                "threshold": cb.failure_threshold} for n, cb in breakers.items()}

@app.post("/circuit-breakers/{service}/reset", tags=["Meta"])
async def reset_circuit_breaker(service: str):
    if service not in breakers:
        raise HTTPException(404, f"Unknown service '{service}'")
    breakers[service].record_success()
    return {"service": service, "state": breakers[service].state}

# ── Enrichment routes ─────────────────────────────────────────────────────────
@app.post("/enrich", response_model=EnrichedLead, tags=["Enrichment"])
async def enrich_single(lead: LeadInput,
                        sources: List[str] = Query(default=["apollo","hunter"])):
    if not lead.domain and not lead.email:
        raise HTTPException(422, "Provide at least 'domain' or 'email'.")
    async with httpx.AsyncClient() as client:
        return await enrich_lead(lead, sources, client)

# ── Bulk routes ───────────────────────────────────────────────────────────────
@app.post("/bulk/upload", response_model=BulkJobResponse, tags=["Bulk"])
async def upload_bulk_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    sources: str  = Query(default="apollo,hunter", description="Comma-separated: apollo,hunter"),
    concurrency: int = Query(default=5, ge=1, le=20),
    notify_webhook: Optional[str] = Query(default=None),
):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only .csv files accepted.")
    raw  = await file.read()
    text = raw.decode("utf-8-sig") if raw[:3] == b'\xef\xbb\xbf' else raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    leads_list: List[LeadInput] = []
    for row in reader:
        row = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
        leads_list.append(LeadInput(
            domain=row.get("domain"), email=row.get("email"),
            first_name=row.get("first_name"), last_name=row.get("last_name"),
            company=row.get("company"),
        ))
        if len(leads_list) >= MAX_BULK_ROWS: break
    if not leads_list: raise HTTPException(400, "CSV contains no valid rows.")
    source_list = [s.strip() for s in sources.split(",") if s.strip()]
    job_id      = await create_job(len(leads_list))
    background_tasks.add_task(process_bulk_job, job_id, leads_list, source_list,
                               concurrency, notify_webhook)
    return BulkJobResponse(
        job_id=job_id, status=JobStatus.QUEUED, total_rows=len(leads_list),
        created_at=datetime.utcnow().isoformat(),
        estimated_seconds=max(1, len(leads_list) // concurrency),
    )

@app.get("/bulk/jobs/{job_id}", response_model=JobStatusResponse, tags=["Bulk"])
async def job_status(job_id: str):
    job = await get_job(job_id)
    if not job: raise HTTPException(404, f"Job '{job_id}' not found.")
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
async def list_bulk_jobs(limit: int = Query(default=20, ge=1, le=100)):
    jobs = await list_jobs(limit)
    return {"jobs": jobs, "total": len(jobs)}

@app.delete("/bulk/jobs/{job_id}", tags=["Bulk"])
async def cancel_job(job_id: str):
    job = await get_job(job_id)
    if not job: raise HTTPException(404, f"Job '{job_id}' not found.")
    if job["status"] in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(409, f"Job already {job['status']}.")
    await update_job(job_id, status=JobStatus.CANCELLED)
    return {"job_id": job_id, "status": JobStatus.CANCELLED}

@app.get("/bulk/jobs/{job_id}/download", tags=["Bulk"])
async def download_results(job_id: str):
    job = await get_job(job_id)
    if not job: raise HTTPException(404, f"Job '{job_id}' not found.")
    if job["status"] != JobStatus.COMPLETED: raise HTTPException(409, "Job not yet completed.")
    results    = await get_all_results(job_id)
    fieldnames = ["domain","email","first_name","last_name","company","full_name",
                  "job_title","linkedin_url","phone","company_size","industry",
                  "location","enrichment_source","confidence_score","enriched_at","error"]
    def _generate():
        buf = io.StringIO()
        w   = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader(); yield buf.getvalue()
        for row in results:
            buf = io.StringIO(); w.writerow(row); yield buf.getvalue()
    return StreamingResponse(_generate(), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=leads_{job_id}.csv"})

# ── Cache routes ──────────────────────────────────────────────────────────────
@app.delete("/cache/{cache_key}", tags=["Cache"])
async def invalidate_cache(cache_key: str):
    from api.services.redis import redis_del
    deleted = await redis_del(f"lead:{cache_key}")
    return {"deleted": deleted}

@app.get("/cache/stats", tags=["Cache"])
async def cache_stats():
    r    = await get_redis()
    keys = await r.keys("lead:*")
    return {"cached_leads": len(keys)}
