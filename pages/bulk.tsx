import Layout from "../components/Layout";
import UploadZone from "../components/UploadZone";
import ProgressBar from "../components/ProgressBar";
import { useCallback, useState } from "react";
import { useRouter } from "next/router";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
type Source = "apollo" | "hunter";

interface UploadResult {
  job_id: string; status: string;
  total_rows: number; created_at: string; estimated_seconds?: number;
}

function validateCsv(text: string): string | null {
  const headers = text.split("\n")[0]?.toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""));
  if (!headers?.some(h => ["domain","email"].includes(h)))
    return `Must have "domain" or "email" column. Found: ${headers?.join(", ")}`;
  return null;
}

export default function BulkPage() {
  const router = useRouter();
  const [file, setFile]           = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sources, setSources]     = useState<Source[]>(["apollo","hunter"]);
  const [concurrency, setConcurrency] = useState(5);
  const [webhook, setWebhook]     = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [result, setResult]       = useState<UploadResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    setFileError(null); setResult(null); setError(null);
    if (!f.name.endsWith(".csv")) { setFileError("Only .csv files accepted."); return; }
    if (f.size > 10 * 1024 * 1024) { setFileError("File exceeds 10 MB."); return; }
    const reader = new FileReader();
    reader.onload = (e) => { const err = validateCsv(e.target?.result as string); if (err) setFileError(err); };
    reader.readAsText(f);
    setFile(f);
  }, []);

  const toggleSource = (s: Source) =>
    setSources(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const submit = async () => {
    if (!file || fileError || sources.length === 0) return;
    setUploading(true); setError(null); setProgress(0);
    const fd = new FormData();
    fd.append("file", file);
    const params = new URLSearchParams({
      sources: sources.join(","), concurrency: String(concurrency),
      ...(webhook ? { notify_webhook: webhook } : {}),
    });
    try {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setProgress(Math.round(ev.loaded / ev.total * 100)); };
      const promise = new Promise<UploadResult>((resolve, reject) => {
        xhr.onload = () => xhr.status < 300
          ? resolve(JSON.parse(xhr.responseText))
          : reject(new Error(JSON.parse(xhr.responseText)?.detail ?? `HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
      });
      xhr.open("POST", `${API}/bulk/upload?${params}`);
      xhr.send(fd);
      setResult(await promise);
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  };

  const reset = () => { setFile(null); setFileError(null); setResult(null); setError(null); setProgress(0); };

  return (
    <Layout>
      <div className="max-w-xl">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-white tracking-tight mb-1"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            Bulk Enrichment
          </h2>
          <p className="text-[#555] text-sm">Apollo + Hunter pipeline · Up to 5,000 leads per job.</p>
        </div>

        {result ? (
          <div className="border-gradient animate-fade-up">
            <div className="card p-8 rounded-xl text-center">
              <div className="text-4xl mb-4 text-[#333]">◈</div>
              <h3 className="font-display text-2xl text-white mb-1" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                Job Created
              </h3>
              <p className="text-[#555] text-sm mb-6">
                {result.total_rows.toLocaleString()} rows queued
                {result.estimated_seconds ? ` · ~${Math.ceil(result.estimated_seconds / 60)} min` : ""}
              </p>
              <div className="bg-[#111] rounded-lg p-4 text-left font-mono text-xs space-y-1.5 mb-6 border border-[#1a1a1a]">
                <div><span className="text-[#444]">job_id  </span><span className="text-white">{result.job_id}</span></div>
                <div><span className="text-[#444]">status  </span><span className="text-white">{result.status}</span></div>
                <div><span className="text-[#444]">created </span><span className="text-white">{new Date(result.created_at).toLocaleString()}</span></div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => router.push(`/jobs?highlight=${result.job_id}`)} className="btn-primary flex-1 py-2.5 text-sm">Monitor Job →</button>
                <button onClick={reset} className="btn-ghost px-5 text-sm">Upload Another</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <UploadZone onFile={handleFile} hint="Columns: domain, email, first_name, last_name, company" />
            {fileError && <p className="text-red-400 text-xs font-mono">✕ {fileError}</p>}

            <div className="card p-5">
              <p className="text-[#444] text-xs font-mono uppercase tracking-widest mb-4">Enrichment Sources</p>
              <div className="space-y-2">
                {([
                  { id: "apollo" as Source, label: "Apollo.io", desc: "Person · company · phone · LinkedIn" },
                  { id: "hunter" as Source, label: "Hunter.io",  desc: "Email finding & verification" },
                ]).map((s) => (
                  <button key={s.id} onClick={() => toggleSource(s.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      sources.includes(s.id) ? "border-white/20 bg-white/5 text-white" : "border-[#1e1e1e] text-[#555] hover:border-[#333]"
                    }`}>
                    <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs transition-all ${
                      sources.includes(s.id) ? "border-white bg-white text-black" : "border-[#333]"
                    }`}>{sources.includes(s.id) ? "✓" : ""}</span>
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-[#555]">{s.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              {sources.length === 0 && <p className="text-yellow-500 text-xs mt-3 font-mono">Select at least one source.</p>}
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[#444] text-xs font-mono uppercase tracking-widest">Concurrency</p>
                <span className="text-white font-mono text-sm">{concurrency} parallel</span>
              </div>
              <input type="range" min={1} max={20} value={concurrency}
                onChange={e => setConcurrency(+e.target.value)}
                className="w-full h-px bg-[#2a2a2a] appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white" />
              <div className="flex justify-between text-xs text-[#444] font-mono mt-2">
                <span>1 — safe</span><span>20 — fast</span>
              </div>
            </div>

            <div>
              <label className="text-[#444] text-xs font-mono uppercase tracking-widest block mb-2">
                Webhook <span className="normal-case text-[#2a2a2a]">(optional)</span>
              </label>
              <input className="input" placeholder="https://your-site.com/webhook"
                type="url" value={webhook} onChange={e => setWebhook(e.target.value)} />
            </div>

            {uploading && <div className="card p-4"><ProgressBar pct={progress} label="Uploading" /></div>}
            {error && <p className="text-red-400 text-xs font-mono">✕ {error}</p>}

            <button onClick={submit}
              disabled={!file || uploading || !!fileError || sources.length === 0}
              className="btn-primary w-full py-3 text-sm disabled:opacity-40">
              {uploading ? "Uploading…" : "Start Enrichment Job →"}
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
