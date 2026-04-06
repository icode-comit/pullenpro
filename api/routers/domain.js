import { Router } from "express";
import { checkDomainHealth } from "../services/dnsChecker.js";

export const domainRouter = Router();

domainRouter.get("/domain/health/:domain", async (req, res) => {
  let domain = req.params.domain.toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (!domain) return res.status(422).json({ error: "Invalid domain." });
  try {
    const result = await checkDomainHealth(domain);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
