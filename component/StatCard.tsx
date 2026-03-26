interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "flat";
  trendValue?: string;
  icon?: string;
  delay?: number;
}

export default function StatCard({ label, value, sub, trend, trendValue, icon, delay = 0 }: StatCardProps) {
  return (
    <div
      className="card p-5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[#444] text-xs font-mono uppercase tracking-widest">{label}</span>
        {icon && <span className="text-[#333] text-lg">{icon}</span>}
      </div>
      <div className="text-white font-display text-3xl tracking-tight mb-1"
           style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
        {value}
      </div>
      {sub && <p className="text-[#555] text-xs mt-1">{sub}</p>}
      {trendValue && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-mono ${
          trend === "up" ? "text-white" : trend === "down" ? "text-[#f88]" : "text-[#666]"
        }`}>
          <span>{trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}</span>
          <span>{trendValue}</span>
        </div>
      )}
    </div>
  );
}
