import Layout from "../components/Layout";
import UploadZone from "../components/UploadZone";
import ProgressBar from "../components/ProgressBar";
import StatCard from "../components/StatCard";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface HygieneResult {
  total: number; valid: number; invalid: number;
  duplicates: number; role_based: number; suppressed: number;
  job_id: string;
}

export default function HygienePage() {
  const [file, setFile]         = useState<File | null>(null);
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<HygieneResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState<string | null>(null);

  const run = async () => {
    if (!file) return;
    setRunning(true); setResult(null); setError(null); setProgress(0);

    // Simulate progress
    const interval = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 8, 90));
    }, 400);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API}/hygiene/clean`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      clearInterval(interval);
      setProgress(100);
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      clearInterval(interval);
      setRunning(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-white tracking-tight mb-1"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            List Hygiene
          </h2>
          <p className="text-[#555] text-sm">Remove duplicates, role-based addresses, and bounce risks in one pass.</p>
        </div>

        {!result ? (
          <div className="space-y-4">
            <UploadZone onFile={setFile} hint="CSV with 'email' column · Max 5,000 rows" />

            {running && (
              <div className="card p-5">
                <p className="text-[#555] text-xs font-mono mb-3">Running hygiene checks…</p>
                <ProgressBar pct={progress} label="Processing" />
                <div className="grid grid-cols-2 gap-2 mt-4 text-xs text-[#444] font-mono">
                  {["Deduplication", "Role detection", "Syntax validation", "Suppression check"].map((s, i) => (
                    <div key={s} className="flex items-center gap-2">
                      <span className={progress > (i + 1) * 22 ? "text-white" : "text-[#333]"}>
                        {progress > (i + 1) * 22 ? "✓" : "○"}
                      </span>
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {file && !running && (
              <button onClick={run} className="btn-primary w-full py-3">
                Run Hygiene Check →
              </button>
            )}
            {error && (
              <div className="card p-4 border-red-900/30 bg-red-950/20 text-red-400 text-sm font-mono">
                ✕ {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 animate-fade-up">
            <div className="grid grid-cols-3 gap-3 stagger">
              <StatCard label="Valid"       value={result.valid}       icon="◎" delay={0} />
              <StatCard label="Removed"     value={result.total - result.valid} icon="⊗" delay={60} />
              <StatCard label="Duplicates"  value={result.duplicates}  icon="⊞" delay={120} />
            </div>
            <div className="grid grid-cols-3 gap-3 stagger">
              <StatCard label="Role-Based"  value={result.role_based}  icon="∿" delay={0} />
              <StatCard label="Suppressed"  value={result.suppressed}  icon="◬" delay={60} />
              <StatCard label="Total Input" value={result.total}       icon="⊹" delay={120} />
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-white text-sm font-semibold">List Quality</p>
                <p className="text-white font-mono text-sm">
                  {Math.round(result.valid / result.total * 100)}%
                </p>
              </div>
              <ProgressBar pct={result.valid / result.total * 100} showLabel={false} />
            </div>

            <div className="flex gap-3">
              <a href={`${API}/hygiene/jobs/${result.job_id}/download`}
                 className="btn-primary flex-1 py-3 text-center text-sm">
                ↓ Download Clean List
              </a>
              <button onClick={() => { setResult(null); setFile(null); setProgress(0); }}
                      className="btn-ghost px-6 text-sm">
                Run Again
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
