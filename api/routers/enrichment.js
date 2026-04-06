import { Router } from "express";
import { enrich as apolloEnrich } from "../services/apollo.js";
import { enrich as hunterEnrich } from "../services/hunter.js";
import { redisGet, redisSet } from "../services/redis.js";

export const enrichmentRouter = Router();

async function enrichLead(lead, sources) {
  const cacheKey = `lead:${lead.domain||""}:${lead.email||""}:${lead.first_name||""}:${lead.last_name||""}`;
  const cached   = await redisGet(cacheKey);
  if (cached) return { ...cached, enrichment_source: "cache" };

  const merged = { ...lead };
  const PIPELINE = ["apollo","hunter"];

  for (const src of PIPELINE.filter(s => sources.includes(s))) {
    const fn = src === "apollo" ? apolloEnrich : hunterEnrich;
    try {
      const result = await fn(merged);
      for (const [k, v] of Object.entries(result)) {
        if (v !== null && v !== undefined && !merged[k]) merged[k] = v;
      }
    } catch (e) {
      console.error(`[${src}]`, e.message);
    }
  }

  merged.enriched_at = new Date().toISOString();
  await redisSet(cacheKey, merged);
  return merged;
}

enrichmentRouter.post("/enrich", async (req, res) => {
  const lead    = req.body;
  const sources = (req.query.sources || "apollo,hunter").split(",").map(s => s.trim());
  if (!lead.domain && !lead.email) {
    return res.status(422).json({ error: "Provide at least domain or email." });
  }
  try {
    const result = await enrichLead(lead, sources);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export { enrichLead };
