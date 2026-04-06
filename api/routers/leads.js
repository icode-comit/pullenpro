import { Router } from "express";
import axios from "axios";

export const leadsRouter = Router();
const API_KEY = process.env.APOLLO_API_KEY || "";

leadsRouter.post("/leads/search", async (req, res) => {
  const f = req.body;
  try {
    const payload = { api_key: API_KEY, page: 1, per_page: 25 };
    if (f.job_title)    payload.person_titles    = [f.job_title];
    if (f.location)     payload.person_locations = [f.location];
    if (f.seniority)    payload.person_seniorities = [f.seniority];
    if (f.company_size) payload.organization_num_employees_ranges = [f.company_size];
    if (f.domain)       payload.q_organization_domains = f.domain;

    const { data } = await axios.post(
      "https://api.apollo.io/v1/mixed_people/search", payload, { timeout: 15000 }
    );
    const leads = (data.people || []).map(p => {
      const org = p.organization || {};
      return {
        email:        p.email,
        first_name:   p.first_name,
        last_name:    p.last_name,
        full_name:    p.name,
        job_title:    p.title,
        linkedin_url: p.linkedin_url,
        company:      org.name,
        industry:     org.industry,
        location:     p.city,
        company_size: String(org.estimated_num_employees || ""),
        confidence_score: 0.85,
      };
    });
    res.json({ leads, total: leads.length });
  } catch (e) {
    res.status(502).json({ error: `Lead search failed: ${e.message}` });
  }
});

leadsRouter.post("/leads/company-search", async (req, res) => {
  const { domain } = req.body;
  try {
    const { data } = await axios.post(
      "https://api.apollo.io/v1/organizations/enrich",
      { api_key: API_KEY, domain }, { timeout: 15000 }
    );
    res.json(data.organization || {});
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
