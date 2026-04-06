import Redis from "ioredis";

let client = null;

export function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || "redis://localhost:6379/0", {
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
    client.on("error", (err) => console.error("[Redis]", err.message));
  }
  return client;
}

export async function redisGet(key) {
  try {
    const raw = await getRedis().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function redisSet(key, value, ttl = Number(process.env.CACHE_TTL) || 3600) {
  try {
    await getRedis().setex(key, ttl, JSON.stringify(value));
  } catch (e) { console.error("[Redis set]", e.message); }
}

export async function redisDel(key) {
  try { return await getRedis().del(key); } catch { return 0; }
}

export async function redisKeys(pattern) {
  try { return await getRedis().keys(pattern); } catch { return []; }
}

export async function closeRedis() {
  if (client) { await client.quit(); client = null; }
}
