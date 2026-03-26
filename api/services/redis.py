import json, os
from typing import Any, Optional
import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))

_client: Optional[aioredis.Redis] = None

async def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = await aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
    return _client

async def redis_get(key: str) -> Optional[Any]:
    r = await get_redis()
    raw = await r.get(key)
    return json.loads(raw) if raw else None

async def redis_set(key: str, value: Any, ttl: int = CACHE_TTL) -> None:
    r = await get_redis()
    await r.setex(key, ttl, json.dumps(value, default=str))

async def redis_del(key: str) -> bool:
    r = await get_redis()
    return bool(await r.delete(key))

async def close():
    global _client
    if _client:
        await _client.aclose()
        _client = None
