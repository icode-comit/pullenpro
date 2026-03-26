import Layout from "../components/Layout";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface PermResult {
  patterns: { email: string; pattern: string; confidence: number }[];
  domain: string;
}

export default function PermutationPage() {
  const [form, setForm]     = useState({ first_name: "", last_name: "", domain: "" });
  const [result, setResult] = useState<PermResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${API}/permutation/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopied(email);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Layout>
      <div className="max-w-xl">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-white tracking-tight mb-1"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            Permutation Engine
          </h2>
          <p className="text-[#555] text-sm">Generate all likely email patterns for any name + domain.</p>
        </div>

        <div className="card p-6 mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#555] text-xs mb-1.5 block">First Name</label>
              <input className="input" placeholder="John"
                value={form.first_name}
                onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-[#555] text-xs mb-1.5 block">Last Name</label>
              <input className="input" placeholder="Smith"
                value={form.last_name}
                onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-[#555] text-xs mb-1.5 block">Domain</label>
            <input className="input" placeholder="company.com"
              value={form.domain}
              onChange={e => setForm(p => ({ ...p, domain: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && generate()} />
          </div>
          <button onClick={generate}
            disabled={loading || !form.first_name || !form.last_name || !form.domain}
            className="btn-primary w-full py-2.5 disabled:opacity-40">
            {loading ? "Generating…" : "Generate Patterns →"}
          </button>
        </div>

        {result && (
          <div className="space-y-2 animate-fade-up stagger">
            <p className="text-[#444] text-xs font-mono uppercase tracking-widest mb-3">
              {result.patterns.length} patterns for {result.domain}
            </p>
            {result.patterns.map((p, i) => (
              <div key={i} className="card p-4 flex items-center gap-4 animate-fade-up group"
                   style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-mono">{p.email}</p>
                  <p className="text-[#444] text-xs mt-0.5">{p.pattern}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-white text-sm font-mono">{Math.round(p.confidence * 100)}%</p>
                    <p className="text-[#333] text-xs">confidence</p>
                  </div>
                  <button
                    onClick={() => copy(p.email)}
                    className="btn-ghost text-xs py-1 px-2.5 opacity-0 group-hover:opacity-100 transition">
                    {copied === p.email ? "✓" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
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
