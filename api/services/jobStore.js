import { v4 as uuid } from "uuid";
import { getRedis, redisGet, redisSet } from "./redis.js";

const JOB_TTL = Number(process.env.JOB_TTL) || 86400;

const jKey = (id) => `job:${id}`;
const rKey = (id) => `job_results:${id}`;

export async function createJob(totalRows, jobType = "enrichment") {
  const jobId = uuid();
  await redisSet(jKey(jobId), {
    job_id: jobId, job_type: jobType,
    status: "queued", total_rows: totalRows,
    processed_rows: 0, successful_rows: 0, failed_rows: 0,
    created_at: new Date().toISOString(),
    started_at: null, completed_at: null, error: null,
  }, JOB_TTL);
  return jobId;
}

export async function getJob(jobId) {
  return redisGet(jKey(jobId));
}

export async function updateJob(jobId, updates) {
  const job = await getJob(jobId);
  if (!job) return;
  // Increment counters rather than overwrite
  if (updates.processed_rows) job.processed_rows  += updates.processed_rows;
  if (updates.successful_rows) job.successful_rows += updates.successful_rows;
  if (updates.failed_rows)    job.failed_rows      += updates.failed_rows;
  // Direct sets
  if (updates.status)       job.status       = updates.status;
  if (updates.started_at)   job.started_at   = updates.started_at;
  if (updates.completed_at) job.completed_at = updates.completed_at;
  if (updates.error !== undefined) job.error = updates.error;
  await redisSet(jKey(jobId), job, JOB_TTL);
}

export async function appendResult(jobId, row) {
  const r = getRedis();
  await r.rpush(rKey(jobId), JSON.stringify(row));
  await r.expire(rKey(jobId), JOB_TTL);
}

export async function getAllResults(jobId) {
  const r    = getRedis();
  const rows = await r.lrange(rKey(jobId), 0, -1);
  return rows.map((r) => JSON.parse(r));
}

export async function listJobs(limit = 20) {
  const keys = await getRedis().keys("job:*");
  const jobs = [];
  for (const key of keys.slice(0, limit * 2)) {
    const raw = await getRedis().get(key);
    if (raw) jobs.push(JSON.parse(raw));
  }
  return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}
