import Layout from "../components/Layout";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import ProgressBar from "../components/ProgressBar";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Job {
  job_id: string; status: string; total_rows: number;
  processed_rows: number; progress_pct: number;
  created_at: string; successful_rows: number; failed_rows: number;
}

const ACTIVITY = [
  { action: "Bulk enrichment completed", detail: "2,400 leads · 94% success", time: "2m ago" },
  { action: "Domain health checked",     detail: "apollo.io · All clear",      time: "8m ago" },
  { action: "Email verified",            detail: "john@acme.com · Valid",      time: "15m ago" },
  { action: "List hygiene run",          detail: "847 rows · 23 suppressed",   time: "1h ago" },
  { action: "Permutation generated",     detail: "stripe.com · 12 patterns",   time: "2h ago" },
];

export default function Dashboard() {
  const [jobs, setJobs]     = useState<Job[]>([]);
  const [cacheStats, setCacheStats] = useState<any>(null);

  useEffect(() => {
    if (!API) return;
    fetch(`${API}/bulk/jobs?limit=5`).then(r => r.json()).then(d => setJobs(d.jobs ?? [])).catch(() => {});
    fetch(`${API}/cache/stats`).then(r => r.json()).then(setCacheStats).catch(() => {});
  }, []);

  const total     = jobs.reduce((s, j) => s + j.total_rows, 0);
  const success   = jobs.reduce((s, j) => s + j.successful_rows, 0);
  const running   = jobs.filter(j => j.status === "running").length;
  const successPct = total > 0 ? Math.round(success / total * 100) : 0;

  return (
    <Layout>
      {/* Header */}
      <div className="mb-8">
        <h2 className="font-display text-3xl text-white tracking-tight"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
          Good morning.
        </h2>
        <p className="text-[#555] text-sm mt-1">Here's what's happening with your leads today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 stagger">
        <StatCard label="Total Leads Processed" value={total.toLocaleString()}
          sub="across all jobs" icon="⊹" delay={0} trend="up" trendValue="vs last week" />
        <StatCard label="Success Rate"  value={`${successPct}%`}
          sub="enriched successfully" icon="◎" delay={60} />
        <StatCard label="Active Jobs"   value={running}
          sub="currently running" icon="≡" delay={120} />
        <StatCard label="Cached Leads"  value={cacheStats?.cached_leads ?? "—"}
          sub="in Redis (1h TTL)" icon="◈" delay={180} />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Recent jobs — wider */}
        <div className="lg:col-span-3 card p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-white text-sm font-semibold">Recent Jobs</h3>
            <a href="/jobs" className="text-[#555] text-xs hover:text-white transition font-mono">
              View all →
            </a>
          </div>

          {jobs.length === 0 ? (
            <p className="text-[#444] text-sm text-center py-8 font-mono">No jobs yet</p>
          ) : (
            <div className="space-y-4">
              {jobs.slice(0, 5).map((job) => (
                <div key={job.job_id} className="group">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={job.status as any} />
                      <span className="text-[#555] text-xs font-mono truncate max-w-[140px]">
                        {job.job_id.slice(0, 8)}…
                      </span>
                    </div>
                    <span className="text-[#444] text-xs font-mono">
                      {job.processed_rows.toLocaleString()} / {job.total_rows.toLocaleString()}
                    </span>
                  </div>
                  <ProgressBar pct={job.progress_pct} showLabel={false} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity feed — narrower */}
        <div className="lg:col-span-2 card p-6">
          <h3 className="text-white text-sm font-semibold mb-5">Activity</h3>
          <div className="space-y-4">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1.5 w-1 h-1 rounded-full bg-[#333] flex-shrink-0" />
                <div>
                  <p className="text-white text-xs font-medium">{a.action}</p>
                  <p className="text-[#555] text-xs mt-0.5">{a.detail}</p>
                </div>
                <span className="ml-auto text-[#333] text-xs font-mono flex-shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Verify Email",      href: "/verify",      icon: "◎" },
          { label: "Bulk Enrich",       href: "/bulk",        icon: "⊞" },
          { label: "Domain Health",     href: "/domain",      icon: "◬" },
          { label: "List Hygiene",      href: "/hygiene",     icon: "⊗" },
        ].map((a) => (
          <a
            key={a.href}
            href={a.href}
            className="card p-4 flex items-center gap-3 group cursor-pointer"
          >
            <span className="text-[#333] group-hover:text-white transition text-lg">{a.icon}</span>
            <span className="text-[#666] group-hover:text-white transition text-sm font-medium">{a.label}</span>
            <span className="ml-auto text-[#333] group-hover:text-white transition text-xs">→</span>
          </a>
        ))}
      </div>
    </Layout>
  );
}
