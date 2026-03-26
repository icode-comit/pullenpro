import Layout from "../components/Layout";
import UploadZone from "../components/UploadZone";
import StatusBadge from "../components/StatusBadge";
import ProgressBar from "../components/ProgressBar";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface VerifyResult {
  email: string; status: "valid" | "invalid" | "risky" | "unknown";
  score: number; checks: Record<string, boolean | string>;
  reason?: string;
}

const TIERS = [
  "Syntax Check", "DNS / MX Lookup", "Domain Existence",
  "Catch-All Detection", "Role-Based Detection",
  "Disposable Provider", "SMTP Verification",
];

export default function VerifyPage() {
  const [mode, setMode]         = useState<"single" | "bulk">("single");
  const [email, setEmail]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<VerifyResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [file, setFile]         = useState<File | null>(null);
  const [jobId, setJobId]       = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeCheck, setActiveCheck] = useState(-1);

  const verifySingle = async () => {
    if (!email.trim()) return;
    setLoading(true); setResult(null); setError(null); setActiveCheck(0);

    // Animate through tiers
    for (let i = 0; i < TIERS.length; i++) {
      setActiveCheck(i);
      await new Promise(r => setTimeout(r, 300));
    }

    try {
      const res = await fetch(`${API}/verify/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false); setActiveCheck(-1);
    }
  };

  const statusColor = (s: string) =>
    s === "valid" ? "text-white" : s === "invalid" ? "text-red-400" : "text-yellow-400";

  return (
    <Layout>
      <div className="max-w-2xl">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-white tracking-tight mb-1"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            Email Verifier
          </h2>
          <p className="text-[#555] text-sm">7-tier verification stack. ZeroBounce-powered SMTP layer.</p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-[#111] rounded-lg border border-[#1e1e1e] mb-6 w-fit">
          {(["single", "bulk"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                mode === m ? "bg-white text-black" : "text-[#555] hover:text-white"
              }`}>
              {m === "single" ? "Single Email" : "Bulk CSV"}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="email@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && verifySingle()}
              />
              <button onClick={verifySingle} disabled={loading || !email.trim()} className="btn-primary px-6 disabled:opacity-40">
                {loading ? "Checking…" : "Verify"}
              </button>
            </div>

            {/* Tier progress */}
            {loading && (
              <div className="card p-5 space-y-2.5">
                <p className="text-[#444] text-xs font-mono uppercase tracking-widest mb-3">Running checks</p>
                {TIERS.map((tier, i) => (
                  <div key={tier} className={`flex items-center gap-3 text-sm transition-all duration-300 ${
                    i < activeCheck ? "text-white" :
                    i === activeCheck ? "text-white" : "text-[#333]"
                  }`}>
                    <span className="font-mono text-xs w-4">
                      {i < activeCheck ? "✓" : i === activeCheck ? "›" : "○"}
                    </span>
                    <span>{tier}</span>
                    {i === activeCheck && (
                      <span className="ml-auto flex gap-0.5">
                        {[0,1,2].map(d => (
                          <span key={d} className="w-1 h-1 rounded-full bg-white animate-pulse"
                                style={{ animationDelay: `${d * 150}ms` }} />
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Result */}
            {result && !loading && (
              <div className="border-gradient">
                <div className="card p-6 rounded-xl animate-fade-up">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-[#555] text-xs font-mono mb-1">{result.email}</p>
                      <p className={`font-display text-4xl font-bold tracking-tight ${statusColor(result.status)}`}
                         style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                        {result.status.toUpperCase()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[#444] text-xs font-mono">Score</p>
                      <p className="text-white text-2xl font-mono font-bold">{result.score}</p>
                      <p className="text-[#444] text-xs">/100</p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <ProgressBar pct={result.score} label="Confidence" />
                  </div>

                  {result.reason && (
                    <p className="text-[#555] text-xs font-mono bg-[#111] rounded-lg px-3 py-2 mb-4">
                      {result.reason}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(result.checks ?? {}).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className={`font-mono ${v === true || v === "pass" ? "text-white" : "text-[#444]"}`}>
                          {v === true || v === "pass" ? "✓" : "○"}
                        </span>
                        <span className="text-[#555] capitalize">{k.replace(/_/g, " ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="card p-4 border-red-900/30 bg-red-950/20 text-red-400 text-sm font-mono">
                ✕ {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <UploadZone onFile={setFile} hint="CSV with 'email' column required" />
            {file && (
              <button className="btn-primary w-full py-3">
                Start Bulk Verification →
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
