import csv, io
from datetime import datetime
from typing import List, Optional
import httpx
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ..services import zerobounce as zb
from ..services.job_store import (
    append_result, create_job, get_all_results, get_job, list_jobs, update_job
)

router = APIRouter(prefix="/verify", tags=["Verification"])

class VerifyRequest(BaseModel):
    email: str

class VerifyResult(BaseModel):
    email:  str
    status: str
    score:  int
    reason: Optional[str] = None
    checks: dict = {}

@router.post("/email", response_model=VerifyResult)
async def verify_single(req: VerifyRequest):
    async with httpx.AsyncClient() as client:
        try:
            result = await zb.verify(req.email, client)
            return VerifyResult(**result)
        except Exception as exc:
            raise HTTPException(502, f"Verification failed: {exc}")

@router.post("/bulk")
async def verify_bulk(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    concurrency: int = Query(default=5, ge=1, le=20),
):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only .csv files accepted.")
    raw  = await file.read()
    text = raw.decode("utf-8-sig") if raw[:3] == b'\xef\xbb\xbf' else raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    emails = [row.get("email","").strip() for row in reader if row.get("email","").strip()]
    if not emails:
        raise HTTPException(400, "No emails found in CSV.")
    job_id = await create_job(len(emails), job_type="verification")
    background_tasks.add_task(_run_bulk, job_id, emails, concurrency)
    return {"job_id": job_id, "total": len(emails), "status": "queued"}

@router.get("/jobs/{job_id}")
async def verify_job_status(job_id: str):
    job = await get_job(job_id)
    if not job: raise HTTPException(404, "Job not found.")
    return job

@router.get("/jobs/{job_id}/download")
async def download_verification(job_id: str):
    job = await get_job(job_id)
    if not job: raise HTTPException(404, "Job not found.")
    if job["status"] != "completed": raise HTTPException(409, "Job not complete.")
    results    = await get_all_results(job_id)
    fieldnames = ["email","status","score","reason","checks"]
    def _gen():
        buf = io.StringIO()
        w   = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader(); yield buf.getvalue()
        for row in results:
            buf = io.StringIO()
            w.writerow(row); yield buf.getvalue()
    return StreamingResponse(_gen(), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=verified_{job_id}.csv"})

async def _run_bulk(job_id: str, emails: List[str], concurrency: int):
    import asyncio
    await update_job(job_id, status="running", started_at=datetime.utcnow().isoformat())
    sem = asyncio.Semaphore(concurrency)
    async def _verify_one(email: str):
        async with sem:
            async with httpx.AsyncClient() as client:
                try:
                    result = await zb.verify(email, client)
                    await append_result(job_id, result)
                    await update_job(job_id,
                        processed_rows=1, successful_rows=1,
                        status="running")
                except Exception as e:
                    await append_result(job_id, {"email": email, "status": "unknown", "score": 0, "reason": str(e)})
                    await update_job(job_id, processed_rows=1, failed_rows=1)
    await asyncio.gather(*[_verify_one(e) for e in emails])
    await update_job(job_id, status="completed", completed_at=datetime.utcnow().isoformat())
