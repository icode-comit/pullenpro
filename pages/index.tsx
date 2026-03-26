import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Health {
  status: string;
  redis: string;
  circuit_breakers: Record<string, string>;
}

const FEATURES = [
  { icon: "⊹", label: "Lead Search",    desc: "Apollo-powered ICP filtering" },
  { icon: "◎", label: "7-Tier Verify",  desc: "Deep email verification stack" },
  { icon: "◬", label: "Domain Health",  desc: "MX · SPF · DKIM · DMARC" },
  { icon: "∿", label: "Permutation",    desc: "Email pattern generation" },
  { icon: "⊗", label: "List Hygiene",   desc: "Bounce handling & suppression" },
  { icon: "⊞", label: "Bulk Enrich",    desc: "Up to 5,000 leads per job" },
];

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    if (!API) return;
    fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  const dot = (s: string) =>
    s === "healthy" || s === "ok" || s === "closed" ? "bg-white" : "bg-red-500";

  return (
    <>
      <Head><title>Pullenspro — Lead Intelligence</title></Head>

      <div className="min-h-screen bg-[#000] overflow-hidden relative">
        {/* Grid background */}
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 70%)" }} />

        <div className="relative z-10 max-w-5xl mx-auto px-8 py-20">
          {/* Hero */}
          <div className="text-center mb-20 stagger">
            <div className="animate-fade-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#222] bg-[#111] mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-dot" />
              <span className="text-[#888] text-xs font-mono tracking-widest uppercase">Lead Intelligence Platform</span>
            </div>

            <h1 className="animate-fade-up font-display text-7xl md:text-8xl text-white leading-none tracking-tight mb-6"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
              Pullens<span className="text-gradient">pro</span>
            </h1>

            <p className="animate-fade-up text-[#555] text-lg max-w-md mx-auto leading-relaxed">
              Find, enrich, and verify leads with precision.
              Built for teams who take deliverability seriously.
            </p>

            <div className="animate-fade-up flex flex-wrap gap-3 justify-center mt-10">
              <button onClick={() => router.push("/dashboard")} className="btn-primary px-8 py-3 text-sm">
                Open Dashboard →
              </button>
              <button onClick={() => router.push("/verify")} className="btn-ghost px-8 py-3 text-sm">
                Verify an Email
              </button>
            </div>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-16 stagger">
            {FEATURES.map((f) => (
              <div key={f.label} className="card-glass p-5 animate-fade-up">
                <div className="text-2xl mb-3 text-[#444]">{f.icon}</div>
                <div className="text-white text-sm font-semibold mb-0.5">{f.label}</div>
                <div className="text-[#555] text-xs">{f.desc}</div>
              </div>
            ))}
          </div>

          {/* System status */}
          {health && (
            <div className="border-gradient animate-fade-up">
              <div className="card p-5 rounded-xl">
                <p className="text-[#444] text-xs font-mono uppercase tracking-widest mb-4">System Status</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "API",     val: health.status },
                    { label: "Redis",   val: health.redis },
                    ...Object.entries(health.circuit_breakers).map(([k, v]) => ({ label: k, val: v })),
                  ].map(({ label, val }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot(val)}`} />
                      <span className="text-[#555] text-xs capitalize font-mono">{label}</span>
                      <span className="text-white text-xs font-mono ml-auto">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-[#2a2a2a] text-xs font-mono mt-16">
            © {new Date().getFullYear()} Pullenspro · All rights reserved
          </p>
        </div>
      </div>
    </>
  );
}
