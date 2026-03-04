import React, { useCallback, useRef, useState } from "react";
import { useRouter } from "next/router";

// ── Types ─────────────────────────────────────────────────────────────────────
type EnrichmentSource = "apollo" | "hunter";

interface UploadOptions {
  sources: EnrichmentSource[];
  concurrency: number;
  notifyWebhook: string;
}

interface UploadResult {
  job_id: string;
  status: string;
  total_rows: number;
  created_at: string;
  estimated_seconds?: number;
}

interface ValidationError {
  row: number;
  message: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_FILE_MB = 10;
const REQUIRED_COLUMNS = ["domain", "email", "first_name", "last_name", "company"];

// ── Helpers ────────────────────────────────────────────────────────────────────
function bytesToMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function validateCsvPreview(text: string): ValidationError[] {
  const lines = text.split("\n").slice(0, 6); // header + 5 rows
  if (!lines.length) return [{ row: 0, message: "File is empty" }];
  const headers = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
  const errors: ValidationError[] = [];
  const hasUseful = headers.some((h) => ["domain", "email"].includes(h));
  if (!hasUseful) {
    errors.push({ row: 0, message: CSV must have at least a "domain" or "email" column. Found: ${headers.join(", ")} });
  }
  return errors;
}

// ── Sub-components ────────────────────────────────────────────────────────────
const SourceBadge: React.FC<{
  source: EnrichmentSource;
  selected: boolean;
  onToggle: (s: EnrichmentSource) => void;
}> = ({ source, selected, onToggle }) => {
  const labels: Record<EnrichmentSource, string> = {
    apollo: "🚀 Apollo.io — person & company",
    hunter: "🎯 Hunter.io — email finding",
  };
  return (
    <button
      type="button"
      onClick={() => onToggle(source)}
      className={`px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all duration-150 select-none ${
        selected
          ? "bg-indigo-600 border-indigo-600 text-white shadow-md"
          : "bg-white border-gray-300 text-gray-600 hover:border-indigo-400"
      }`}
    >
      {labels[source]}
    </button>
  );
};

const ProgressBar: React.FC<{ pct: number; color?: string }> = ({
  pct,
  color = "bg-indigo-500",
}) => (
  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
    <div
      className={${color} h-2 rounded-full transition-all duration-500}
      style={{ width: ${Math.min(100, pct)}% }}
    />
  </div>
);

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function BulkUploadPage() {
  const router = useRouter();

  // Drag-drop state
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileErrors, setFileErrors] = useState<ValidationError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Options
  const [options, setOptions] = useState<UploadOptions>({
    sources: ["apollo", "hunter"],
    concurrency: 5,
    notifyWebhook: "",
  });

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── File handling ────────────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    setError(null);
    setFileErrors([]);
    setResult(null);

    if (!f.name.endsWith(".csv")) {
      setFileErrors([{ row: 0, message: "Only CSV files are accepted." }]);
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setFileErrors([{ row: 0, message: File exceeds ${MAX_FILE_MB} MB limit. }]);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const errs = validateCsvPreview(text);
      setFileErrors(errs);
    };
    reader.readAsText(f);
    setFile(f);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  // ── Source toggle ────────────────────────────────────────────────────────────
  const toggleSource = (source: EnrichmentSource) => {
    setOptions((prev) => ({
      ...prev,
      sources: prev.sources.includes(source)
        ? prev.sources.filter((s) => s !== source)
        : [...prev.sources, source],
    }));
  };

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (fileErrors.length > 0) return;
    if (options.sources.length === 0) {
      setError("Select at least one enrichment source.");
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    const params = new URLSearchParams({
      sources: options.sources.join(","),
      concurrency: String(options.concurrency),
      ...(options.notifyWebhook ? { notify_webhook: options.notifyWebhook } : {}),
    });

    try {
      // Simulate upload progress (XHR for real progress)
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };

      const uploadPromise = new Promise<UploadResult>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const body = JSON.parse(xhr.responseText);
              reject(new Error(body?.detail ?? HTTP ${xhr.status}));
            } catch {
              reject(new Error(HTTP ${xhr.status}));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
      });

      xhr.open("POST", ${API_BASE}/bulk/upload?${params});
      xhr.send(formData);

      const data = await uploadPromise;
      setResult(data);
      setUploadProgress(100);
    } catch (err: any) {
      setError(err.message ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const reset = () => {
    setFile(null);
    setFileErrors([]);
    setResult(null);
    setError(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center py-14 px-4">
      {/* Header */}
      <div className="mb-10 text-center max-w-xl">
        <span className="inline-block text-5xl mb-3">⚡</span>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
          Bulk Lead Enrichment
        </h1>
        <p className="mt-2 text-gray-500">
          Upload a CSV, choose your data sources, and we'll enrich every row in
          parallel — up to 5,000 leads per job.
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Success state */}
        {result ? (
          <div className="p-10 text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Job Created!</h2>
            <p className="text-gray-500 mb-6">
              <span className="font-semibold text-indigo-700">{result.total_rows.toLocaleString()}</span>{" "}
              rows are being enriched. Estimated time:{" "}
              <span className="font-semibold">
                {result.estimated_seconds
                  ? ~${Math.ceil(result.estimated_seconds / 60)} min
                  : "a few minutes"}
              </span>
              .
            </p>

            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6 font-mono text-sm space-y-1">
              <div>
                <span className="text-gray-400">job_id: </span>
                <span className="text-indigo-700 font-bold">{result.job_id}</span>
              </div>
              <div>
                <span className="text-gray-400">status: </span>
                <span className="text-green-600 font-semibold">{result.status}</span>
              </div>
              <div>
                <span className="text-gray-400">created: </span>
                {new Date(result.created_at).toLocaleString()}
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => router.push(/jobs?highlight=${result.job_id})}
                className="px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition"
              >
                Monitor Job →
              </button>
              <button
                onClick={reset}
                className="px-6 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition"
              >
                Upload Another
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-8 space-y-8">
            {/* Drop zone */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                CSV File
              </label>
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                  isDragging
                    ? "border-indigo-500 bg-indigo-50 scale-[1.01]"
                    : file
                    ? "border-green-400 bg-green-50"
                    : "border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={onInputChange}
                />

                {file ? (
                  <>
                    <span className="text-3xl mb-1">📄</span>
                    <p className="font-semibold text-gray-800">{file.name}</p>
                    <p className="text-sm text-gray-400">{bytesToMB(file.size)} MB</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); reset(); }}
                      className="mt-2 text-xs text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-3xl mb-2">☁️</span>
                    <p className="text-gray-600 font-medium">
                      Drag & drop your CSV here
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      or <span className="text-indigo-600 font-semibold">click to browse</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      Columns: domain, email, first_name, last_name, company
                    </p>
                  </>
                )}
              </div>

              {/* Validation errors */}
              {fileErrors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {fileErrors.map((err, i) => (
                    <p key={i} className="text-sm text-red-600 flex items-start gap-1">
                      <span>⚠️</span> {err.message}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Enrichment sources */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Enrichment Sources
              </label>
              <div className="flex flex-wrap gap-3">
                {(["apollo", "hunter"] as EnrichmentSource[]).map((s) => (
                  <SourceBadge
                    key={s}
                    source={s}
                    selected={options.sources.includes(s)}
                    onToggle={toggleSource}
                  />
                ))}
              </div>
              {options.sources.length === 0 && (
                <p className="mt-2 text-sm text-amber-600">
                  ⚠️ Select at least one source.
                </p>
              )}
            </div>

            {/* Concurrency slider */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Concurrency{" "}
                <span className="text-indigo-600 font-bold">
                  {options.concurrency}
                </span>{" "}
                <span className="text-gray-400 font-normal">
                  parallel requests
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={20}
                value={options.concurrency}
                onChange={(e) =>
                  setOptions((p) => ({ ...p, concurrency: +e.target.value }))
                }
                className="w-full accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>1 (safe)</span>
                <span>20 (fast)</span>
              </div>
            </div>

            {/* Webhook */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Notify Webhook{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://your-site.com/webhook"
                value={options.notifyWebhook}
                onChange={(e) =>
                  setOptions((p) => ({ ...p, notifyWebhook: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            {/* Upload progress */}
            {uploading && (
              <div>
                <p className="text-sm text-gray-500 mb-1">
                  Uploading… {uploadProgress}%
                </p>
                <ProgressBar pct={uploadProgress} />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                ❌ {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!file || uploading || fileErrors.length > 0 || options.sources.length === 0}
              className="w-full py-3 px-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-lg hover:shadow-indigo-200"
            >
              {uploading ? "Uploading…" : "🚀 Start Enrichment Job"}
            </button>
          </form>
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-8 flex gap-6 text-sm text-gray-400">
        <button
          onClick={() => router.push("/jobs")}
          className="hover:text-indigo-600 transition"
        >
          View All Jobs →
        </button>
        <a
          href={${API_BASE}/docs}
          target="_blank"
          rel="noreferrer"
          className="hover:text-indigo-600 transition"
        >
          API Docs ↗
        </a>
      </div>
    </div>
  );
}