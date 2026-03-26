import Layout from "../components/Layout";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface DomainHealth {
  domain: string;
  mx: { valid: boolean; records: string[] };
  spf: { valid: boolean; record?: string };
  dkim: { valid: boolean };
  dmarc: { valid: boolean; policy?: string };
  spam_score: { listed: boolean; lists: string[] };
  overall: "healthy" | "warning" | "critical";
}

const CHECK_LABELS = [
  { key: "mx",         label: "MX Records",     icon: "◎", desc: "Mail exchange routing" },
  { key: "spf",        label: "SPF Record",      icon: "◬", desc: "Sender policy framework" },
  { key: "dkim",       label: "DKIM",            icon: "⊹", desc: "Domain key signature" },
  { key: "dmarc",      label: "DMARC Policy",    icon: "⊗", desc: "Authentication reporting" },
  { key: "spam_score", label: "Blacklist Status", icon: "∿", desc: "Spamhaus & SURBL check" },
];

export default function DomainPage() {
  const [domain,  setDomain]  = useState("");
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<DomainHealth | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);

  const checkDomain = async () => {
    if (!domain.trim()) return;
    setLoading(true); setResult(null); setError(null); setChecked([]);

    // Animate checks appearing
    for (const c of CHECK_LABELS) {
      await new Promise(r => setTimeout(r, 250));
      setChecked(prev => [...prev, c.key]);
    }

    try {
      const res = await fetch(`${API}/domain/health/${encodeURIComponent(domain.trim())}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const overallColor = (o?: string) =>
    o === "healthy" ? "text-white" : o === "warning" ? "text-yellow-400" : "text-red-400";

  const checkStatus = (key: string): boolean => {
    if (!result) return false;
    const r = result[key as keyof DomainHealth] as any;
    if (key === "spam_score") return !r?.listed;
    return r?.valid ?? false;
  };

  return (
    <Layout>
      <div className="max-w-2xl">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-white tracking-tight mb-1"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            Domain Health
          </h2>
          <p className="text-[#555] text-sm">MX · SPF · DKIM · DMARC · Blacklist — full scan in seconds.</p>
        </div>

        {/* Input */}
        <div className="flex gap-2 mb-6">
          <input
            className="input flex-1"
            placeholder="company.com"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            onKeyDown={e => e.key === "Enter" && checkDomain()}
          />
          <button onClick={checkDomain} disabled={loading || !domain.trim()} className="btn-primary px-6 disabled:opacity-40">
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>

        {/* Checks grid */}
        {(loading || result) && (
          <div className="grid grid-cols-1 gap-3 mb-6">
            {CHECK_LABELS.map((c, i) => {
              const isChecked = checked.includes(c.key);
              const pass = result ? checkStatus(c.key) : null;
              return (
                <div
                  key={c.key}
                  className={`card p-4 flex items-center gap-4 transition-all duration-300 ${
                    isChecked ? "opacity-100" : "opacity-0 translate-y-2"
                  }`}
                >
                  <div className={`text-xl w-8 flex-shrink-0 ${
                    pass === null ? "text-[#333]" : pass ? "text-white" : "text-red-400"
                  }`}>{c.icon}</div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">{c.label}</p>
                    <p className="text-[#555] text-xs">{c.desc}</p>
                    {result && c.key === "mx" && result.mx.records.length > 0 && (
                      <p className="text-[#444] text-xs font-mono mt-1 truncate">
                        {result.mx.records[0]}
                      </p>
                    )}
                    {result && c.key === "spf" && result.spf.record && (
                      <p className="text-[#444] text-xs font-mono mt-1 truncate">
                        {result.spf.record}
                      </p>
                    )}
                    {result && c.key === "dmarc" && result.dmarc.policy && (
                      <p className="text-[#444] text-xs font-mono mt-1">
                        Policy: {result.dmarc.policy}
                      </p>
                    )}
                    {result && c.key === "spam_score" && result.spam_score.lists.length > 0 && (
                      <p className="text-red-400 text-xs font-mono mt-1">
                        Listed on: {result.spam_score.lists.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {loading && !result ? (
                      <span className="flex gap-0.5">
                        {[0,1,2].map(d => (
                          <span key={d} className="w-1 h-1 rounded-full bg-[#333] animate-pulse"
                                style={{ animationDelay: `${d*150}ms` }} />
                        ))}
                      </span>
                    ) : (
                      <span className={`font-mono text-xs font-bold ${
                        pass ? "text-white" : "text-red-400"
                      }`}>
                        {pass ? "PASS" : "FAIL"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Overall verdict */}
        {result && (
          <div className="border-gradient animate-fade-up">
            <div className="card p-6 rounded-xl text-center">
              <p className="text-[#444] text-xs font-mono uppercase tracking-widest mb-2">Overall Assessment</p>
              <p className={`font-display text-5xl font-bold ${overallColor(result.overall)}`}
                 style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                {result.overall.toUpperCase()}
              </p>
              <p className="text-[#555] text-sm mt-2">{result.domain}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="card p-4 border-red-900/30 bg-red-950/20 text-red-400 text-sm font-mono">
            ✕ {error}
          </div>
        )}
      </div>
    </Layout>
  );
}
