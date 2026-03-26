import csv, io
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ..services.deduplicator import deduplicate, detect_role_emails
from ..services.job_store import create_job, update_job, append_result, get_all_results, get_job

router = APIRouter(prefix="/hygiene", tags=["Hygiene"])

@router.post("/clean")
async def clean_list(file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only .csv files accepted.")
    raw  = await file.read()
    text = raw.decode("utf-8-sig") if raw[:3] == b'\xef\xbb\xbf' else raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    rows   = [dict(row) for row in reader]
    total  = len(rows)
    if total == 0: raise HTTPException(400, "CSV is empty.")

    # 1. Deduplicate
    rows, dupes = deduplicate(rows)
    # 2. Role-based detection
    rows, role_count = detect_role_emails(rows)
    # 3. Filter out role-based from clean list
    clean = [r for r in rows if not r.get("_role_based")]
    # Clean up internal flags
    for r in clean:
        r.pop("_role_based", None)

    job_id = await create_job(total, job_type="hygiene")
    for r in clean:
        await append_result(job_id, r)
    await update_job(job_id, status="completed", completed_at=datetime.utcnow().isoformat(),
                     processed_rows=total, successful_rows=len(clean),
                     failed_rows=total - len(clean))

    return {
        "job_id":     job_id,
        "total":      total,
        "valid":      len(clean),
        "invalid":    total - len(clean),
        "duplicates": dupes,
        "role_based": role_count,
        "suppressed": 0,
    }

@router.get("/jobs/{job_id}/download")
async def download_clean(job_id: str):
    job = await get_job(job_id)
    if not job: raise HTTPException(404, "Job not found.")
    if job["status"] != "completed": raise HTTPException(409, "Not complete.")
    results = await get_all_results(job_id)
    if not results: raise HTTPException(404, "No results.")
    fieldnames = list(results[0].keys())
    def _gen():
        buf = io.StringIO()
        w   = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader(); yield buf.getvalue()
        for row in results:
            buf = io.StringIO()
            w.writerow(row); yield buf.getvalue()
    return StreamingResponse(_gen(), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=clean_{job_id}.csv"})

@router.post("/suppress")
async def add_suppression(email: str):
    from ..services.redis import redis_set
    await redis_set(f"suppressed:{email.lower().strip()}", True, ttl=365*24*3600)
    return {"suppressed": email}

@router.get("/suppression-list")
async def get_suppression_list():
    from ..services.redis import get_redis
    r    = await get_redis()
    keys = await r.keys("suppressed:*")
    return {"emails": [k.replace("suppressed:", "") for k in keys], "total": len(keys)}
