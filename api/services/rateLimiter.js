import { getRedis } from "./redis.js";

const LIMIT  = Number(process.env.RATE_LIMIT_REQUESTS) || 100;
const WINDOW = Number(process.env.RATE_LIMIT_WINDOW)   || 60;

export async function checkRateLimit(req, res, next) {
  const ip  = req.ip || "unknown";
  const key = `rl:${ip}`;
  const now = Date.now() / 1000;
  const win = now - WINDOW;
  try {
    const r    = getRedis();
    const pipe = r.pipeline();
    pipe.zremrangebyscore(key, "-inf", win);
    pipe.zadd(key, now, String(now));
    pipe.zcard(key);
    pipe.expire(key, WINDOW);
    const results = await pipe.exec();
    const count   = results[2][1];
    const remaining = Math.max(0, LIMIT - count);
    const resetAt   = Math.floor(now) + WINDOW;
    res.set("X-RateLimit-Limit",     String(LIMIT));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset",     String(resetAt));
    if (count > LIMIT) {
      return res.status(429).json({ error: "rate_limit_exceeded", reset_at: resetAt });
    }
    next();
  } catch { next(); }
}
