type Status = "queued" | "running" | "completed" | "failed" | "cancelled" | "valid" | "invalid" | "risky" | "unknown";

const DOT: Record<Status, string> = {
  queued:    "bg-[#444]",
  running:   "bg-white animate-pulse",
  completed: "bg-white",
  failed:    "bg-red-500",
  cancelled: "bg-[#333]",
  valid:     "bg-white",
  invalid:   "bg-red-500",
  risky:     "bg-yellow-500",
  unknown:   "bg-[#333]",
};

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[status] ?? "bg-[#444]"}`} />
      {status}
    </span>
  );
}
