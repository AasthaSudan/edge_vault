"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, Home, Inbox, MessageSquare, RefreshCw, Search, Shield } from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { useEdgeConnected } from "@/lib/sse";
import { StatusMenu } from "./StatusMenu";
import { PrivacyCheck } from "./PrivacyCheck";
import { StatusDot, cn } from "./ui";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  // Secondary pages that live under this item
  also?: string[];
}

const NAV: NavItem[] = [
  { name: "Home", href: "/", icon: Home },
  { name: "Ask", href: "/assistant", icon: MessageSquare },
  { name: "Notes", href: "/memories", icon: FileText, also: ["/search"] },
  { name: "Review", href: "/suggestions", icon: Inbox, also: ["/conflicts"] },
  { name: "Sync", href: "/sync", icon: RefreshCw },
];

// Items waiting on the user: share suggestions plus open sync conflicts
export function useReviewCount() {
  const { data: suggestions } = useQuery({
    queryKey: ["pending-suggestions"],
    queryFn: () => fetchEdge("/suggestions?status=pending"),
    refetchInterval: POLL_MS,
  });
  const { data: conflicts } = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => fetchEdge("/conflicts"),
    refetchInterval: POLL_MS,
  });
  const s = Array.isArray(suggestions) ? suggestions.length : 0;
  const c = Array.isArray(conflicts) ? conflicts.filter((x: any) => x.status === "open").length : 0;
  return { suggestions: s, conflicts: c, total: s + c };
}

function useIsActive() {
  const pathname = usePathname();
  return (href: string, also: string[] = []) =>
    href === "/" ? pathname === "/" : [href, ...also].some((p) => pathname.startsWith(p));
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-on-accent text-[11px] font-semibold flex items-center justify-center tabular-nums",
        className
      )}
    >
      {n}
    </span>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-on-accent flex items-center justify-center shadow-glow">
        <Shield className="w-4 h-4" />
      </span>
      <span className="leading-tight">
        <span className="block font-semibold tracking-tight">EdgeVault</span>
        {!compact && <span className="block text-[11px] text-muted">Private by default</span>}
      </span>
    </Link>
  );
}

function Sidebar() {
  const isActive = useIsActive();
  const review = useReviewCount();
  const connected = useEdgeConnected();

  // Activity sits with the rest here; on phones it's reached from Sync
  const items: NavItem[] = [...NAV, { name: "Activity", href: "/activity", icon: Activity }];

  // No backdrop-blur on the fixed/sticky bars: the browser re-blurs what's behind them on
  // every scroll frame, which is the main scroll jank on a laptop GPU.
  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-line bg-subtle/40">
      <div className="h-16 flex items-center px-5">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-4">
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.also);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 h-10 px-3 rounded-xl text-sm transition-colors",
                    active ? "bg-surface text-fg font-medium shadow-card ring-1 ring-line" : "text-muted hover:text-fg hover:bg-surface/60"
                  )}
                >
                  <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-accent" : "text-faint group-hover:text-muted")} />
                  <span className="flex-1">{item.name}</span>
                  {item.href === "/suggestions" && <Badge n={review.total} />}
                  {item.href === "/activity" && <StatusDot className={connected ? "bg-ok" : "bg-faint"} pulse={connected} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* The Sync page shows the full privacy check */}
      {!isActive("/sync") && (
        <div className="p-3">
          <PrivacyCheck compact />
        </div>
      )}
    </aside>
  );
}

function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/memories?q=${encodeURIComponent(term)}` : "/memories");
    setQ("");
  };

  return (
    <header className="sticky top-0 z-30 h-14 lg:h-16 border-b border-line bg-bg">
      <div className="h-full flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <div className="lg:hidden">
          <Brand compact />
        </div>

        {/* The Notes page has its own search box */}
        {pathname.startsWith("/memories") ? (
          <span className="hidden sm:block flex-1" />
        ) : (
          <form onSubmit={search} className="hidden sm:block relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search notes by problem, fix or equipment…"
              aria-label="Search notes"
              className="input h-9 pl-9 bg-surface/80 rounded-xl"
            />
          </form>
        )}

        <StatusMenu />
      </div>
    </header>
  );
}

function TabBar() {
  const isActive = useIsActive();
  const review = useReviewCount();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-5">
        {NAV.map((item) => {
          const Icon = item.icon;
          // On phones the activity log is reached from Sync
          const active = isActive(item.href, item.href === "/sync" ? ["/activity"] : item.also);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors",
                active ? "text-accent" : "text-faint"
              )}
            >
              {active && <span className="absolute top-0 inset-x-6 h-0.5 rounded-full bg-accent" />}
              <span className="relative">
                <Icon className="w-5 h-5" />
                {item.href === "/suggestions" && <Badge n={review.total} className="absolute -top-1.5 -right-3 h-4 min-w-[16px] text-[10px]" />}
              </span>
              {item.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:pl-64">
      <Sidebar />
      <div className="page-glow pointer-events-none fixed inset-x-0 top-0 h-[420px] -z-10" />
      <Topbar />
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pt-6 sm:pt-8 pb-28 lg:pb-12">{children}</main>
      <TabBar />
    </div>
  );
}
