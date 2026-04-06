import "dotenv/config";
import express from "express";
import cors from "cors";
import { getRedis, redisKeys, closeRedis } from "./services/redis.js";
import { breakers } from "./services/circuitBreaker.js";
import { checkRateLimit } from "./services/rateLimiter.js";
import { enrichmentRouter } from "./routers/enrichment.js";
import { bulkRouter }        from "./routers/bulk.js";
import { verificationRouter } from "./routers/verification.js";
import { domainRouter }       from "./routers/domain.js";
import { leadsRouter }        from "./routers/leads.js";
import { permutationRouter }  from "./routers/permutation.js";
import { hygieneRouter }      from "./routers/hygiene.js";

const app  = express();
const PORT = process.env.PORT || 8000;

// ── CORS ─────────────────────────────────────────────────────
const rawOrigins = process.env.ALLOWED_ORIGINS || "*";
const origins    = rawOrigins === "*" ? "*"
  : rawOrigins.split(",").map(o => o.trim());

app.use(cors({
  origin: origins,
  methods: ["GET","POST","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With"],
  exposedHeaders: ["X-RateLimit-Limit","X-RateLimit-Remaining","X-RateLimit-Reset"],
  credentials: true,
}));
app.options("*", cors());

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting (skip meta routes) ─────────────────────────
app.use((req, res, next) => {
  if (["/","/health","/circuit-breakers"].includes(req.path)) return next();
  checkRateLimit(req, res, next);
});

// ── Meta routes ───────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ service: "Pullenspro", version: "2.0.0", status: "ok" });
});

app.get("/health", async (req, res) => {
  let redisOk = false;
  try { await getRedis().ping(); redisOk = true; } catch {}
  res.json({
    status:           redisOk ? "healthy" : "degraded",
    redis:            redisOk ? "ok" : "unavailable",
    circuit_breakers: Object.fromEntries(
      Object.entries(breakers).map(([k, v]) => [k, v.state])
    ),
    timestamp: new Date().toISOString(),
  });
});

app.get("/circuit-breakers", (req, res) => {
  res.json(Object.fromEntries(
    Object.entries(breakers).map(([k, v]) => [k, v.toJSON()])
  ));
});

app.post("/circuit-breakers/:service/reset", (req, res) => {
  const cb = breakers[req.params.service];
  if (!cb) return res.status(404).json({ error: `Unknown service '${req.params.service}'` });
  cb.recordSuccess();
  res.json({ service: req.params.service, state: cb.state });
});

// ── Cache routes ──────────────────────────────────────────────
app.delete("/cache/:key", async (req, res) => {
  const { redisDel } = await import("./services/redis.js");
  const deleted = await redisDel(`lead:${req.params.key}`);
  res.json({ deleted: deleted > 0 });
});

app.get("/cache/stats", async (req, res) => {
  const keys = await redisKeys("lead:*");
  res.json({ cached_leads: keys.length });
});

// ── Feature routers ───────────────────────────────────────────
app.use(enrichmentRouter);
app.use(bulkRouter);
app.use(verificationRouter);
app.use(domainRouter);
app.use(leadsRouter);
app.use(permutationRouter);
app.use(hygieneRouter);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found." }));

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: err.message || "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Pullenspro API running on port ${PORT}`);
  getRedis().ping()
    .then(() => console.log("Redis connected ✓"))
    .catch(() => console.warn("Redis unavailable at startup"));
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  server.close();
  await closeRedis();
  process.exit(0);
});
