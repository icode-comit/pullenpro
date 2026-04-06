import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { verify } from "../services/zerobounce.js";
import { createJob, getJob, updateJob, appendResult, getAllResults } from "../services/jobStore.js";

export const verificationRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

verificationRouter.post("/verify/email", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(422).json({ error: "email is required." });
  try {
    const result = await verify(email);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: `Verification failed: ${e.message}` });
  }
});

verificationRouter.post("/verify/bulk", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const concurrency = Math.min(Number(req.query.concurrency) || 5, 20);
  let records;
  try {
    records = parse(req.file.buffer.toString("utf-8"), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }
  const emails = records.map(r => r.email || r.Email || "").filter(Boolean);
  if (!emails.length) return res.status(400).json({ error: "No emails found in CSV." });
  const jobId = await createJob(emails.length, "verification");
  res.json({ job_id: jobId, total: emails.length, status: "queued" });
  setImmediate(() => _runBulkVerify(jobId, emails, concurrency));
});

async function _runBulkVerify(jobId, emails, concurrency) {
  await updateJob(jobId, { status: "running", started_at: new Date().toISOString() });
  const queue   = [...emails];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const email = queue.shift();
      try {
        const result = await verify(email);
        await appendResult(jobId, result);
        await updateJob(jobId, { processed_rows: 1, successful_rows: 1 });
      } catch (e) {
        await appendResult(jobId, { email, status: "unknown", score: 0, reason: e.message });
        await updateJob(jobId, { processed_rows: 1, failed_rows: 1 });
      }
    }
  });
  await Promise.all(workers);
  await updateJob(jobId, { status: "completed", completed_at: new Date().toISOString() });
}

verificationRouter.get("/verify/jobs/:jobId", async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json(job);
});

verificationRouter.get("/verify/jobs/:jobId/download", async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.status !== "completed") return res.status(409).json({ error: "Not complete." });
  const results = await getAllResults(req.params.jobId);
  const csv = stringify(results, { header: true, columns: ["email","status","score","reason"] });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=verified_${req.params.jobId}.csv`);
  res.send(csv);
});
