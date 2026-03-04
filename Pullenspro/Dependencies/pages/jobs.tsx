import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

// ── Types ─────────────────────────────────────────────────────────────────────
type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface Job {
  job_id: string;
  status: JobStatus;
  total_rows: number;
  processed_rows: number;
  successful_rows: number;
  failed_rows: number;
  progress_pct: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  download_ready: boolean;
}

interface JobListResponse {
  jobs: Job[];
  total: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Smart polling: interval grows for idle jobs, shrinks for active ones
const POLL_INTERVALS: Record<JobStatus, number> = {
  queued:    2000,
  running:   1500,
  completed: 30000,
  failed:    30000,
  cancelled: 30000,
};

const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 30000;

// ── Helpers ────────────────────────────────────────────────────────────────────
function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return ${s}s ago;
  const m = Math.floor(s / 60);
  if (m < 60) return ${m}m ago;
  return ${Math.floor(m / 60)}h ago;
}

function duration(start?: string, end?: string): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const secs = Math.floor((e - s) / 1000);
  if (secs < 60) return ${secs}s;
  return ${Math.floor(secs / 60)}m ${secs % 60}s;
}

// ── Status Badge ───────────────────────────────────────────────────────────────
const StatusBadge: React.FC<{ status: JobStatus }> = ({ status }) => {
  const styles: Record<JobStatus, string> = {
    queued:    "bg-yellow-100 text-yellow-700 border-yellow-200",
    running:   "bg-blue-100   text-blue-700   border-blue-200",
    completed: "bg-green-100  text-green-700  border-green-200",
    failed:    "bg-red-100    text-red-700    border-red-200",
    cancelled: "bg-gray-100   text-gray-600   border-gray-200",
  };
  const icons: Record<JobStatus, string> = {
    queued:    "⏳",
    running:   "⚡",
    completed: "✅",
    failed:    "❌",
    cancelled: "🚫",
  };
  return (
    <span
      className={inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status]}}
    >
      {icons[status]} {status}
    </span>
  );
};

// ── Progress Bar ───────────────────────────────────────────────────────────────
const ProgressBar: React.FC<{ pct: number; status: JobStatus }> = ({ pct, status }) => {
  const colors: Partial<Record<JobStatus, string>> = {
    running:   "bg-blue-500",
    completed: "bg-green-500",
    failed:    "bg-red-400",
    cancelled: "bg-gray-400",
  };
  const color = colors[status] ?? "bg-yellow-400";
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div
        className={${color} h-1.5 rounded-full transition-all duration-700 ease-out}
        style={{ width: ${Math.min(100, pct)}% }}
      />
    </div>
  );
};

// ── Job Card ───────────────────────────────────────────────────────────────────
const JobCard: React.FC<{
  job: Job;
  highlight: boolean;
  onCancel: (id: string) => void;
}> = ({ job, highlight, onCancel }) => {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel(job.job_id);
    setCancelling(false);
  };

  const isActive = job.status === "queued" || job.status === "running";

  return (
    <div
      className={`bg-white rounded-xl border-2 transition-all duration-300 shadow-sm hover:shadow-md p-5 ${
        highlight ? "border-indigo-400 shadow-indigo-100" : "border-gray-100"
      }`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={job.status} />
            {highlight && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
                ← Latest
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-gray-400 truncate">{job.job_id}</p>
        </div>

        <div className="flex gap-2 flex-shrink-0">
          {job.download_ready && (
            <a
              href={${API_BASE}/bulk/jobs/${job.job_id}/download}
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
            >
              ↓ CSV
            </a>
          )}
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg font-semibold hover:bg-red-100 disabled:opacity-50 transition"
            >
              {cancelling ? "…" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>
            {job.processed_rows.toLocaleString()} / {job.total_rows.toLocaleString()} rows
          </span>
          <span>{job.progress_pct}%</span>
        </div>
        <ProgressBar pct={job.progress_pct} status={job.status} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 mb-3 text-center">
        <div className="bg-green-50 rounded-lg p-2">
          <p className="text-lg font-bold text-green-700">{job.successful_rows.toLocaleString()}</p>
          <p className="text-xs text-green-600">Enriched</p>
        </div>
        <div className="bg-red-50 rounded-lg p-2">
          <p className="text-lg font-bold text-red-600">{job.failed_rows.toLocaleString()}</p>
          <p className="text-xs text-red-500">Failed</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-700">
            {(job.total_rows - job.processed_rows).toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">Remaining</p>
        </div>
      </div>

      {/* Time info */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>Created {relativeTime(job.created_at)}</span>
        {job.started_at && (
          <span>Duration {duration(job.started_at, job.completed_at)}</span>
        )}
        {job.completed_at && <span>Finished {relativeTime(job.completed_at)}</span>}
      </div>

      {/* Error */}
      {job.error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
          ❌ {job.error}
        </div>
      )}
    </div>
  );
};

// ── Smart Poller ───────────────────────────────────────────────────────────────
function useSmartPoller(
  jobs: Job[],
  onTick: () => Promise<void>
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computeInterval = useCallback((jobs: Job[]): number => {
    if (jobs.some((j) => j.status === "running")) return POLL_INTERVALS.running;
    if (jobs.some((j) => j.status === "queued"))  return POLL_INTERVALS.queued;
    return MAX_POLL_MS;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const schedule = async () => {
      if (cancelled) return;
      await onTick();
      if (cancelled) return;
      const interval = computeInterval(jobs);
      timerRef.current = setTimeout(schedule, interval);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return computeInterval(jobs);
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function JobsPage() {
  const router = useRouter();
  const highlight = (router.query.highlight as string) ?? null;

  const [jobs, setJobs]           = useState<Job[]>([]);
  const [loading, setLoading]     = useState(true);
  const [lastUpdated, setUpdated] = useState<Date | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<JobStatus | "all">("all");
  const [search, setSearch]       = useState("");
  const pollCountRef              = useRef(0);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(${API_BASE}/bulk/jobs?limit=50);
      if (!res.ok) throw new Error(HTTP ${res.status});
      const data: JobListResponse = await res.json();
      setJobs(data.jobs ?? []);
      setLastUpdated(new Date());
      setError(null);
      pollCountRef.current += 1;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Smart polling — fast when jobs are active
  const currentInterval = useSmartPoller(jobs, fetchJobs);

  // ── Cancel ─────────────────────────────────────────────────────────────────
  const handleCancel = useCallback(async (jobId: string) => {
    try {
      await fetch(${API_BASE}/bulk/jobs/${jobId}, { method: "DELETE" });
      await fetchJobs();
    } catch {
      // ignore
    }
  }, [fetchJobs]);

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = jobs.filter((j) => {
    if (filter !== "all" && j.status !== filter) return false;
    if (search && !j.job_id.includes(search)) return false;
    return true;
  });

  const activeCount    = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const failedCount    = jobs.filter((j) => j.status === "failed").length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
              📋 Job Monitor
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Smart polling every{" "}
              <span className="font-semibold text-indigo-600">
                {currentInterval / 1000}s
              </span>{" "}
              · Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "…"}
            </p>
          </div>
          <button
            onClick={() => router.push("/bulk")}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition shadow"
          >
            + New Upload
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Active",    value: activeCount,    color: "blue"  },
            { label: "Completed", value: completedCount, color: "green" },
            { label: "Failed",    value: failedCount,    color: "red"   },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
              <p className={text-2xl font-extrabold text-${color}-600}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5 items-center">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "queued", "running", "completed", "failed", "cancelled"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                  filter === s
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-indigo-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search job ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 w-44"
          />
          <button
            onClick={fetchJobs}
            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition font-semibold"
            title="Refresh now"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            ⚠️ Could not load jobs: {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 h-40 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-3">🗂</p>
            <p className="text-lg font-semibold text-gray-500">No jobs found</p>
            <p className="text-sm mt-1">
              {jobs.length === 0
                ? "Upload a CSV to create your first enrichment job."
                : "Try adjusting the filter."}
            </p>
            {jobs.length === 0 && (
              <button
                onClick={() => router.push("/bulk")}
                className="mt-5 px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 transition"
              >
                Upload CSV →
              </button>
            )}
          </div>
        )}

        {/* Job list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-4">
            {/* Highlighted job first */}
            {filtered
              .slice()
              .sort((a, b) => {
                if (a.job_id === highlight) return -1;
                if (b.job_id === highlight) return 1;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              })
              .map((job) => (
                <JobCard
                  key={job.job_id}
                  job={job}
                  highlight={job.job_id === highlight}
                  onCancel={handleCancel}
                />
              ))}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-8">
          {jobs.length} total jobs · Poll #{pollCountRef.current}
        </p>
      </div>
    </div>
  );
}