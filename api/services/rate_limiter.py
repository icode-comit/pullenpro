import time, os
from fastapi import HTTPException, Request, status
from pydantic import BaseModel
from .redis import get_redis

RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW   = int(os.getenv("RATE_LIMIT_WINDOW",   "60"))

class RateLimitInfo(BaseModel):
    limit: int; remaining: int; reset_at: int

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
    results  = await pipe.execute()
    count    = results[2]
    remaining = max(0, RATE_LIMIT_REQUESTS - count)
    reset_at  = int(now) + RATE_LIMIT_WINDOW
    if count > RATE_LIMIT_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate_limit_exceeded", "reset_at": reset_at},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )
    return RateLimitInfo(limit=RATE_LIMIT_REQUESTS, remaining=remaining, reset_at=reset_at)
