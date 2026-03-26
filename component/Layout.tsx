import { useRouter } from "next/router";
import Link from "next/link";
import { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  tag?: string;
}

const NAV: NavItem[] = [
  { href: "/dashboard",     label: "Dashboard",    icon: "◈" },
  { href: "/leads",         label: "Lead Search",  icon: "⊹" },
  { href: "/bulk",          label: "Bulk Enrich",  icon: "⊞" },
  { href: "/verify",        label: "Verify",       icon: "◎" },
  { href: "/domain",        label: "Domain Health",icon: "◬" },
  { href: "/permutation",   label: "Permutation",  icon: "∿" },
  { href: "/hygiene",       label: "List Hygiene", icon: "⊗" },
  { href: "/jobs",          label: "Jobs",         icon: "≡" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-[#1a1a1a]">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center flex-shrink-0">
              <span className="text-black text-xs font-bold">P</span>
            </div>
            <span
              className="text-white font-display text-lg tracking-tight"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              Pullenspro
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = router.pathname === item.href ||
                           router.pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group relative ${
                  active
                    ? "bg-white text-black font-semibold"
                    : "text-[#666] hover:text-white hover:bg-[#161616]"
                }`}
              >
                <span className={`text-base leading-none ${active ? "text-black" : "text-[#444] group-hover:text-white"}`}>
                  {item.icon}
                </span>
                <span className="tracking-[-0.01em]">{item.label}</span>
                {item.tag && (
                  <span className="ml-auto text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-white/10 text-white/40">
                    {item.tag}
                  </span>
                )}
                {active && (
                  <span className="absolute right-2 w-1 h-1 rounded-full bg-black" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-[#1a1a1a]">
          <div className="flex items-center gap-2.5">
            <div className="animate-pulse-dot w-1.5 h-1.5 rounded-full bg-white" />
            <span className="text-[#444] text-xs font-mono">system online</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-[#1a1a1a] bg-[#0a0a0a]/80 backdrop-blur px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-white text-sm font-semibold capitalize tracking-[-0.01em]">
              {NAV.find(n => router.pathname.startsWith(n.href))?.label ?? "Pullenspro"}
            </h1>
            <p className="text-[#444] text-xs font-mono mt-0.5">
              {new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/verify"
              className="btn-primary text-xs py-2 px-4"
            >
              + Verify Email
            </Link>
          </div>
        </header>

        {/* Page content */}
        <div className="p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
