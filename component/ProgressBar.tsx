interface Props {
  pct: number;
  label?: string;
  showLabel?: boolean;
}
export default function ProgressBar({ pct, label, showLabel = true }: Props) {
  return (
    <div>
      {showLabel && (
        <div className="flex justify-between text-xs text-[#555] font-mono mb-1.5">
          <span>{label ?? "Progress"}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
