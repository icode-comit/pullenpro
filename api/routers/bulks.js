import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { createJob, getJob, updateJob, appendResult, getAllResults, listJobs } from "../services/jobStore.js";
import { enrichLead } from "./enrichment.js";

export const bulkRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_BULK_ROWS = Number(process.env.MAX_BULK_ROWS) || 5000;

bulkRouter.post("/bulk/upload", upload.single("file"), async (req, res) => {
  if (!req.file || !req.file.originalname.endsWith(".csv")) {
    return res.status(400).json({ error: "Only .csv files accepted." });
  }
  const sources     = (req.query.sources || "apollo,hunter").split(",").map(s => s.trim());
  const concurrency = Math.min(Number(req.query.concurrency) || 5, 20);
  const webhook     = req.query.notify_webhook || null;

  let records;
  try {
    records = parse(req.file.buffer.toString("utf-8"), {
      columns: true, skip_empty_lines: true, trim: true,
    }).slice(0, MAX_BULK_ROWS);
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }
  if (!records.length) return res.status(400).json({ error: "CSV has no valid rows." });

  const leads = records.map(r => ({
    domain: r.domain || r.Domain || "",
    email:  r.email  || r.Email  || "",
    first_name: r.first_name || r["First Name"] || "",
    last_name:  r.last_name  || r["Last Name"]  || "",
    company:    r.company    || r.Company       || "",
  }));

  const jobId = await createJob(leads.length);
  res.json({
    job_id: jobId, status: "queued", total_rows: leads.length,
    created_at: new Date().toISOString(),
    estimated_seconds: Math.max(1, Math.ceil(leads.length / concurrency)),
  });

  // Run async after response
  setImmediate(() => _processBulk(jobId, leads, sources, concurrency, webhook));
});

async function _processBulk(jobId, leads, sources, concurrency, webhook) {
  await updateJob(jobId, { status: "running", started_at: new Date().toISOString() });
  const queue = [...leads];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const lead = queue.shift();
      const job  = await getJob(jobId);
      if (job?.status === "cancelled") return;
      try {
        const result = await enrichLead(lead, sources);
        await appendResult(jobId, result);
        await updateJob(jobId, { processed_rows: 1, successful_rows: 1 });
      } catch (e) {
        await appendResult(jobId, { ...lead, error: e.message });
        await updateJob(jobId, { processed_rows: 1, failed_rows: 1 });
      }
    }
  });
  await Promise.all(workers);
  const job = await getJob(jobId);
  if (job?.status !== "cancelled") {
    await updateJob(jobId, { status: "completed", completed_at: new Date().toISOString() });
  }
  if (webhook) {
    try {
      const { default: axios } = await import("axios");
      await axios.post(webhook, await getJob(jobId), { timeout: 10000 });
    } catch {}
  }
}

bulkRouter.get("/bulk/jobs", async (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const jobs  = await listJobs(limit);
  res.json({ jobs, total: jobs.length });
});

bulkRouter.get("/bulk/jobs/:jobId", async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  const { total_rows: t, processed_rows: p } = job;
  res.json({ ...job, progress_pct: t > 0 ? Math.round(p / t * 100 * 10) / 10 : 0,
             download_ready: job.status === "completed" });
});

bulkRouter.delete("/bulk/jobs/:jobId", async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (["completed","failed","cancelled"].includes(job.status)) {
    return res.status(409).json({ error: `Job already ${job.status}.` });
  }
  await updateJob(req.params.jobId, { status: "cancelled" });
  res.json({ job_id: req.params.jobId, status: "cancelled" });
});

bulkRouter.get("/bulk/jobs/:jobId/download", async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.status !== "completed") return res.status(409).json({ error: "Job not complete." });
  const results = await getAllResults(req.params.jobId);
  const cols    = ["domain","email","first_name","last_name","company","full_name",
                   "job_title","linkedin_url","phone","company_size","industry",
                   "location","enrichment_source","confidence_score","enriched_at","error"];
  const csv = stringify(results, { header: true, columns: cols });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=leads_${req.params.jobId}.csv`);
  res.send(csv);
});
