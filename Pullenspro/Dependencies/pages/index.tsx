import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface HealthData {
  status: string;
  redis: string;
  circuit_breakers: Record<string, string>;
}

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!API_BASE) { setChecking(false); return; }
    fetch(${API_BASE}/health, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => setHealth(null))
      .finally(() => setChecking(false));
  }, []);

  const statusColor = (s: string) =>
    s === "healthy" || s === "ok" || s === "closed"
      ? "text-green-600"
      : s === "degraded" || s === "half_open"
      ? "text-yellow-500"
      : "text-red-500";

  return (
    <>
      <Head>
        <title>Pullenspro — Lead Enrichment</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col items-center justify-center px-4 text-white">
        {/* Logo / hero */}
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">⚡</div>
          <h1 className="text-5xl font-extrabold tracking-tight mb-3">
            Pullenspro
          </h1>
          <p className="text-indigo-300 text-lg max-w-md mx-auto">
            High-performance B2B lead enrichment — powered by Hunter, Clearbit
            &amp; Apollo with Redis caching and circuit breakers.
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-wrap gap-4 justify-center mb-14">
          <button
            onClick={() => router.push("/bulk")}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition text-lg"
          >
            Upload CSV →
          </button>
          <button
            onClick={() => router.push("/jobs")}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold rounded-xl transition text-lg"
          >
            View Jobs
          </button>
          <a
            href={${API_BASE}/docs}
            target="_blank"
            rel="noreferrer"
            className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold rounded-xl transition text-lg"
          >
            API Docs ↗
          </a>
        </div>

        {/* System status card */}
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur">
          <h2 className="text-sm font-semibold text-indigo-300 uppercase tracking-widest mb-4">
            System Status
          </h2>

          {checking && (
            <p className="text-sm text-gray-400 animate-pulse">Checking…</p>
          )}

          {!checking && !health && (
            <p className="text-sm text-red-400">⚠️ API unreachable</p>
          )}

          {!checking && health && (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-gray-400">API</span>
                <span className={font-semibold ${statusColor(health.status)}}>
                  {health.status}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-gray-400">Redis</span>
                <span className={font-semibold ${statusColor(health.redis)}}>
                  {health.redis}
                </span>
              </li>
              {Object.entries(health.circuit_breakers).map(([name, state]) => (
                <li key={name} className="flex justify-between">
                  <span className="text-gray-400 capitalize">{name}</span>
                  <span className={font-semibold ${statusColor(state)}}>
                    {state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-10 text-xs text-indigo-400/50">
          © {new Date().getFullYear()} Pullenspro. All rights reserved.
        </p>
      </div>
    </>
  );
}