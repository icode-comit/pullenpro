import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import ProgressBar from "../components/ProgressBar";
import EmptyState from "../components/EmptyState";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface Job {
  job_id: string; status: JobStatus; total_rows: number;
  processed_rows: number; successful_rows: number; failed_rows: number;
  progress_pct: number; created_at: string; started_at?: string;
  completed_at?: string; error?: string; download_ready: boolean;
}

const POLL: Record<JobStatus, number> = {
  queued: 2000, running: 1500, completed: 30000, failed: 30000, cancelled: 30000,
};

function relTime(iso?: string) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}
function dur(start?: string, end?: string) {
  if (!start) return "—";
  const s = Math.floor(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
}

function JobCard({ job, highlight, onCancel }: { job: Job; highlight: boolean; onCancel: (id: string) => void }) {
  const [cancelling, setCancelling] = useState(false);
  const isActive = job.status === "queued" || job.status === "running";

  return (
    <div className={`card p-5 animate-fade-up transition-all ${highlight ? "border-white/20" : ""}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={job.status} />
            {highlight && (
              <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                Latest
              </span>
            )}
          </div>
          <p className="text-[#333] text-xs font-mono">{job.job_id}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {job.download_ready && (
            <a href={`${API}/bulk/jobs/${job.job_id}/download`}
               className="btn-primary text-xs py-1.5 px-3">↓ CSV</a>
          )}
          {isActive && (
            <button onClick={async () => { setCancelling(true); await onCancel(job.job_id); setCancelling(false); }}
              disabled={cancelling}
              className="btn-ghost text-xs py-1.5 px-3 text-red-400 border-red-900/30 hover:bg-red-950/20 hover:text-red-300 disabled:opacity-40">
              {cancelling ? "…" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-xs text-[#555] font-mono mb-1.5">
          <span>{job.processed_rows.toLocaleString()} / {job.total_rows.toLocaleString()} rows</span>
          <span>{job.progress_pct}%</span>
        </div>
        <ProgressBar pct={job.progress_pct} showLabel={false} />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Enriched",  value: job.successful_rows, dim: false },
          { label: "Failed",    value: job.failed_rows,     dim: true  },
          { label: "Remaining", value: job.total_rows - job.processed_rows, dim: false },
        ].map(({ label, value, dim }) => (
          <div key={label} className="bg-[#111] border border-[#1a1a1a] rounded-lg p-2.5 text-center">
            <p className={`text-lg font-mono font-bold ${dim && value > 0 ? "text-red-400" : "text-white"}`}>
              {value.toLocaleString()}
            </p>
            <p className="text-[#444] text-xs">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 text-xs text-[#444] font-mono">
        <span>Created {relTime(job.created_at)}</span>
        {job.started_at && <span>Duration {dur(job.started_at, job.completed_at)}</span>}
        {job.completed_at && <span>Finished {relTime(job.completed_at)}</span>}
      </div>

      {job.error && (
        <div className="mt-3 bg-red-950/20 border border-red-900/30 rounded-lg p-2.5 text-xs text-red-400 font-mono">
          ✕ {job.error}
        </div>
      )}
    </div>
  );
}

export default function JobsPage() {
  const router    = useRouter();
  const highlight = (router.query.highlight as string) ?? null;
  const [jobs, setJobs]         = useState<Job[]>([]);
  const [loading, setLoading]   = useState(true);
  const [lastUpdated, setLast]  = useState<Date | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<JobStatus | "all">("all");
  const [search, setSearch]     = useState("");
  const pollCount               = useRef(0);
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/bulk/jobs?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setJobs(d.jobs ?? []);
      setLast(new Date());
      setError(null);
      pollCount.current += 1;
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchJobs();
    const schedule = () => {
      const hasActive = jobs.some(j => j.status === "running" || j.status === "queued");
      const interval  = hasActive ? 1500 : 30000;
      timerRef.current = setTimeout(async () => { await fetchJobs(); schedule(); }, interval);
    };
    schedule();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [fetchJobs]);

  const handleCancel = useCallback(async (id: string) => {
    try { await fetch(`${API}/bulk/jobs/${id}`, { method: "DELETE" }); await fetchJobs(); } catch {}
  }, [fetchJobs]);

  const filtered = jobs
    .filter(j => (filter === "all" || j.status === filter) && (!search || j.job_id.includes(search)))
    .sort((a, b) => {
      if (a.job_id === highlight) return -1;
      if (b.job_id === highlight) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const counts = {
    active:    jobs.filter(j => j.status === "running" || j.status === "queued").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed:    jobs.filter(j => j.status === "failed").length,
  };

  return (
    <Layout>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-3xl text-white tracking-tight mb-1"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            Job Monitor
          </h2>
          <p className="text-[#444] text-xs font-mono">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
            {" · "} Poll #{pollCount.current}
          </p>
        </div>
        <a href="/bulk" className="btn-primary text-sm">+ New Upload</a>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Active",    value: counts.active },
          { label: "Completed", value: counts.completed },
          { label: "Failed",    value: counts.failed },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4 text-center">
            <p className="font-display text-3xl text-white" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
              {value}
            </p>
            <p className="text-[#444] text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex gap-1 flex-wrap">
          {(["all","queued","running","completed","failed","cancelled"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                filter === s ? "bg-white text-black border-white" : "border-[#222] text-[#555] hover:border-[#444] hover:text-white"
              }`}>
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <input className="input text-xs py-1.5 w-44"
            placeholder="Search job ID…" value={search}
            onChange={e => setSearch(e.target.value)} />
          <button onClick={fetchJobs} className="btn-ghost text-xs py-1.5 px-3">↻</button>
        </div>
      </div>

      {error && (
        <div className="card p-3 border-red-900/30 bg-red-950/20 text-red-400 text-xs font-mono mb-4">
          ✕ {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card h-44 animate-pulse" style={{ animationDelay: `${i*80}ms` }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="≡" title={jobs.length === 0 ? "No jobs yet" : "No jobs match your filter"}
          description={jobs.length === 0 ? "Upload a CSV to create your first enrichment job." : "Try adjusting the filter."}
          action={jobs.length === 0 ? { label: "Upload CSV →", href: "/bulk" } : undefined} />
      ) : (
        <div className="space-y-3">
          {filtered.map((job, i) => (
            <div key={job.job_id} style={{ animationDelay: `${i*40}ms` }}>
              <JobCard job={job} highlight={job.job_id === highlight} onCancel={handleCancel} />
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[#2a2a2a] text-xs font-mono mt-8">
        {jobs.length} total jobs
      </p>
    </Layout>
  );
}
