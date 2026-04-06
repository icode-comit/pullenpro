import axios from "axios";
import { breakers } from "./circuitBreaker.js";

const API_KEY = process.env.HUNTER_API_KEY || "";

export async function enrich(lead) {
  const cb = breakers.hunter;
  if (!cb.allowRequest()) throw new Error("Hunter circuit breaker OPEN");
  try {
    if (lead.domain && lead.first_name && lead.last_name) {
      const { data } = await axios.get("https://api.hunter.io/v2/email-finder", {
        params: { domain: lead.domain, first_name: lead.first_name,
                  last_name: lead.last_name, api_key: API_KEY },
        timeout: 10000,
      });
      const d = data.data || {};
      cb.recordSuccess();
      return { email: d.email || null,
               confidence_score: (d.score || 0) / 100,
               enrichment_source: "hunter" };
    }
    if (lead.domain) {
      const { data } = await axios.get("https://api.hunter.io/v2/domain-search", {
        params: { domain: lead.domain, api_key: API_KEY, limit: 1 },
        timeout: 10000,
      });
      const emails = data.data?.emails || [];
      if (emails.length) {
        const t = emails[0];
        cb.recordSuccess();
        return { email: t.value || null, first_name: t.first_name || null,
                 last_name: t.last_name || null, job_title: t.position || null,
                 confidence_score: (t.confidence || 0) / 100,
                 enrichment_source: "hunter" };
      }
    }
    cb.recordSuccess();
    return {};
  } catch (err) {
    cb.recordFailure();
    throw err;
  }
}
