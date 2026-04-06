import { Router } from "express";
import { generate } from "../services/permutationEngine.js";

export const permutationRouter = Router();

permutationRouter.post("/permutation/generate", (req, res) => {
  const { first_name, last_name, domain } = req.body;
  if (!first_name || !last_name || !domain) {
    return res.status(422).json({ error: "first_name, last_name, and domain are required." });
  }
  const patterns = generate(first_name, last_name, domain);
  res.json({ domain, patterns });
});
