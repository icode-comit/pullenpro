import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { deduplicate, detectRoleEmails } from "../services/deduplicator.js";
import { createJob, updateJob, appendResult, getAllResults, getJob } from "../services/jobStore.js";
import { getRedis, redisSet, redisKeys } from "../services/redis.js";

export const hygieneRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

hygieneRouter.post("/hygiene/clean", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  let records;
  try {
    records = parse(req.file.buffer.toString("utf-8"), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }
  if (!records.length) return res.status(400).json({ error: "CSV is empty." });
  const total = records.length;
  const { clean: deduped, dupes } = deduplicate(records);
  const { rows: annotated, roleCount } = detectRoleEmails(deduped);
  const clean = annotated.filter(r => !r._role_based).map(({ _role_based, ...r }) => r);
  const jobId = await createJob(total, "hygiene");
  for (const r of clean) await appendResult(jobId, r);
  await updateJob(jobId, {
    status: "completed", completed_at: new Date().toISOString(),
    processed_rows: total, successful_rows: clean.length,
    failed_rows: total - clean.length,
  });
  res.json({
    job_id: jobId, total, valid: clean.length,
    invalid: total - clean.length,
    duplicates: dupes, role_based: roleCount, suppressed: 0,
  });
});

hygieneRouter.get("/hygiene/jobs/:jobId/download", async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.status !== "completed") return res.status(409).json({ error: "Not complete." });
  const results = await getAllResults(req.params.jobId);
  if (!results.length) return res.status(404).json({ error: "No results." });
  const csv = stringify(results, { header: true, columns: Object.keys(results[0]) });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=clean_${req.params.jobId}.csv`);
  res.send(csv);
});

hygieneRouter.post("/hygiene/suppress", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(422).json({ error: "email is required." });
  await redisSet(`suppressed:${email.toLowerCase().trim()}`, true, 365 * 24 * 3600);
  res.json({ suppressed: email });
});

hygieneRouter.get("/hygiene/suppression-list", async (req, res) => {
  const keys   = await redisKeys("suppressed:*");
  const emails = keys.map(k => k.replace("suppressed:", ""));
  res.json({ emails, total: emails.length });
});
