import Layout from "../components/Layout";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Lead {
  email: string; first_name?: string; last_name?: string;
  company?: string; job_title?: string; industry?: string;
  location?: string; company_size?: string; linkedin_url?: string;
  confidence_score?: number;
}

const INDUSTRIES = ["SaaS","Fintech","Healthcare","E-commerce","Consulting","Media","Education","Real Estate",""];
const SIZES      = ["1-10","11-50","51-200","201-500","500+",""];
const SENIORITY  = ["C-Level","VP","Director","Manager","Individual Contributor",""];

export default function LeadsPage() {
  const [filters, setFilters] = useState({
    domain: "", job_title: "", industry: "", location: "",
    company_size: "", seniority: "", first_name: "", last_name: "",
  });
  const [results, setResults]   = useState<Lead[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const set = (k: string, v: string) => setFilters(p => ({ ...p, [k]: v }));

  const search = async () => {
    setLoading(true); setError(null); setSearched(true);
    try {
      const res = await fetch(`${API}/leads/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([,v]) => v))),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setResults(d.leads ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="mb-8">
        <h2 className="font-display text-3xl text-white tracking-tight mb-1"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
          Lead Search
        </h2>
        <p className="text-[#555] text-sm">Apollo-powered search with ICP filters.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filter panel */}
        <div className="lg:col-span-1 space-y-4">
          <div className="card p-5 space-y-4">
            <p className="text-[#444] text-xs font-mono uppercase tracking-widest">Filters</p>

            {[
              { key: "domain",     placeholder: "company.com", label: "Domain" },
              { key: "first_name", placeholder: "First name",  label: "First Name" },
              { key: "last_name",  placeholder: "Last name",   label: "Last Name" },
              { key: "job_title",  placeholder: "CEO, Engineer…", label: "Job Title" },
              { key: "location",   placeholder: "City or country", label: "Location" },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[#555] text-xs mb-1.5 block">{f.label}</label>
                <input className="input text-sm" placeholder={f.placeholder}
                  value={filters[f.key as keyof typeof filters]}
                  onChange={e => set(f.key, e.target.value)} />
              </div>
            ))}

            {[
              { key: "industry",     label: "Industry",     options: INDUSTRIES },
              { key: "company_size", label: "Company Size", options: SIZES },
              { key: "seniority",    label: "Seniority",    options: SENIORITY },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[#555] text-xs mb-1.5 block">{f.label}</label>
                <select className="input text-sm bg-[#111]"
                  value={filters[f.key as keyof typeof filters]}
                  onChange={e => set(f.key, e.target.value)}>
                  <option value="">Any</option>
                  {f.options.filter(Boolean).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            ))}

            <button onClick={search} disabled={loading}
              className="btn-primary w-full py-2.5 text-sm disabled:opacity-40">
              {loading ? "Searching…" : "Search Leads"}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-3">
          {!searched && !loading ? (
            <EmptyState icon="⊹" title="Set your filters and search"
              description="Use ICP filters to find the exact leads you need." />
          ) : loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => (
                <div key={i} className="card h-20 animate-pulse" style={{ animationDelay: `${i*80}ms` }} />
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState icon="◎" title="No leads found"
              description="Try adjusting your filters." />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[#555] text-xs font-mono">{results.length} leads found</p>
                <button className="btn-ghost text-xs py-1.5 px-3">↓ Export CSV</button>
              </div>
              {results.map((lead, i) => (
                <div key={i} className="card p-4 flex items-center gap-4 animate-fade-up"
                     style={{ animationDelay: `${i * 40}ms` }}>
                  {/* Avatar placeholder */}
                  <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] border border-[#242424] flex items-center justify-center flex-shrink-0">
                    <span className="text-[#333] text-sm font-mono">
                      {(lead.first_name?.[0] ?? lead.email[0]).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">
                      {lead.first_name && lead.last_name
                        ? `${lead.first_name} ${lead.last_name}`
                        : lead.email}
                    </p>
                    <p className="text-[#555] text-xs truncate">
                      {[lead.job_title, lead.company].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="hidden md:flex flex-col items-end gap-1">
                    {lead.industry && (
                      <span className="text-[#444] text-xs font-mono">{lead.industry}</span>
                    )}
                    {lead.location && (
                      <span className="text-[#333] text-xs">{lead.location}</span>
                    )}
                  </div>
                  {lead.confidence_score && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-white text-sm font-mono font-bold">
                        {Math.round(lead.confidence_score * 100)}
                      </p>
                      <p className="text-[#333] text-xs">score</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="card p-4 border-red-900/30 bg-red-950/20 text-red-400 text-sm font-mono mt-4">
              ✕ {error}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
