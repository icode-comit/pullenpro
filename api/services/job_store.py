import json, uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from .redis import get_redis
import os

JOB_TTL = int(os.getenv("JOB_TTL", "86400"))

def _jkey(job_id: str) -> str: return f"job:{job_id}"
def _rkey(job_id: str) -> str: return f"job_results:{job_id}"

async def create_job(total_rows: int, job_type: str = "enrichment") -> str:
    job_id = str(uuid.uuid4())
    r = await get_redis()
    await r.setex(_jkey(job_id), JOB_TTL, json.dumps({
        "job_id": job_id, "job_type": job_type,
        "status": "queued", "total_rows": total_rows,
        "processed_rows": 0, "successful_rows": 0, "failed_rows": 0,
        "created_at": datetime.utcnow().isoformat(),
        "started_at": None, "completed_at": None, "error": None,
    }, default=str))
    return job_id

async def get_job(job_id: str) -> Optional[Dict]:
    r = await get_redis()
    raw = await r.get(_jkey(job_id))
    return json.loads(raw) if raw else None

async def update_job(job_id: str, **kwargs) -> None:
    r    = await get_redis()
    raw  = await r.get(_jkey(job_id))
    if not raw: return
    job  = json.loads(raw)
    job.update({k: v for k, v in kwargs.items() if v is not None or k in ("error",)})
    await r.setex(_jkey(job_id), JOB_TTL, json.dumps(job, default=str))

async def append_result(job_id: str, row: Dict) -> None:
    r = await get_redis()
    await r.rpush(_rkey(job_id), json.dumps(row, default=str))
    await r.expire(_rkey(job_id), JOB_TTL)

async def get_all_results(job_id: str) -> List[Dict]:
    r    = await get_redis()
    rows = await r.lrange(_rkey(job_id), 0, -1)
    return [json.loads(row) for row in rows]

async def list_jobs(limit: int = 20) -> List[Dict]:
    r    = await get_redis()
    keys = await r.keys("job:*")
    jobs = []
    for key in keys[:limit * 2]:
        raw = await r.get(key)
        if raw: jobs.append(json.loads(raw))
    return sorted(jobs, key=lambda j: j.get("created_at",""), reverse=True)[:limit]
