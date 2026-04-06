import axios from "axios";
import { breakers } from "./circuitBreaker.js";

const API_KEY = process.env.ZEROBOUNCE_API_KEY || "";

const STATUS_MAP = {
  "valid":       "valid",
  "invalid":     "invalid",
  "catch-all":   "risky",
  "unknown":     "unknown",
  "spamtrap":    "invalid",
  "abuse":       "invalid",
  "do_not_mail": "invalid",
};

const ROLE_ACCOUNTS = new Set([
  "info","contact","admin","support","help","sales","hello",
  "noreply","no-reply","postmaster","webmaster","team","hr",
  "careers","jobs","marketing","billing","office","mail",
]);

export async function verify(email) {
  const cb = breakers.zerobounce;
  if (!cb.allowRequest()) throw new Error("ZeroBounce circuit breaker OPEN");
  try {
    const { data } = await axios.get("https://api.zerobounce.net/v2/validate", {
      params: { api_key: API_KEY, email },
      timeout: 20000,
    });
    const status = STATUS_MAP[data.status] || "unknown";
    const local  = email.split("@")[0]?.toLowerCase() || "";
    cb.recordSuccess();
    return {
      email,
      status,
      score: _score(data),
      reason: data.sub_status || data.status || null,
      checks: {
        mx_found:    data.mx_found === "true",
        smtp_provider: data.smtp_provider || "",
        catch_all:   data.catch_all === "true",
        role_based:  ROLE_ACCOUNTS.has(local),
        disposable:  data.disposable === "true",
        free_email:  data.free_email === "true",
      },
    };
  } catch (err) {
    cb.recordFailure();
    throw err;
  }
}

function _score(data) {
  const s = data.status || "";
  if (s === "valid")     return 95;
  if (s === "catch-all") return 55;
  if (s === "unknown")   return 30;
  return 0;
}
