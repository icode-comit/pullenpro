import axios from "axios";
import { breakers } from "./circuitBreaker.js";

const API_KEY = process.env.APOLLO_API_KEY || "";

export async function enrich(lead) {
  const cb = breakers.apollo;
  if (!cb.allowRequest()) throw new Error("Apollo circuit breaker OPEN");
  try {
    const payload = { api_key: API_KEY };
    for (const f of ["email","domain","first_name","last_name"]) {
      if (lead[f]) payload[f] = lead[f];
    }
    const { data } = await axios.post(
      "https://api.apollo.io/v1/people/match", payload, { timeout: 15000 }
    );
    const person = data.person || {};
    const org    = person.organization || {};
    const phones = person.phone_numbers || [{}];
    cb.recordSuccess();
    return {
      email:        person.email        || null,
      first_name:   person.first_name   || null,
      last_name:    person.last_name    || null,
      full_name:    person.name         || null,
      job_title:    person.title        || null,
      linkedin_url: person.linkedin_url || null,
      phone:        phones[0]?.sanitized_number || null,
      company:      org.name            || null,
      domain:       org.primary_domain  || null,
      company_size: String(org.estimated_num_employees || ""),
      industry:     org.industry        || null,
      location:     person.city         || null,
      enrichment_source: "apollo",
      confidence_score: 0.88,
    };
  } catch (err) {
    cb.recordFailure();
    throw err;
  }
}
