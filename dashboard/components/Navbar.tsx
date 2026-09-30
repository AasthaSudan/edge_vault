"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Home, MessageSquare, FileText, Inbox, RefreshCw, Shield } from "lucide-react";
import { fetchEdge } from "@/lib/api";
import { StatusMenu } from "./StatusMenu";
import { cn } from "./ui";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  // Secondary pages that live under this tab
  also?: string[];
}

const NAV: NavItem[] = [
  { name: "Home", href: "/", icon: Home },
  { name: "Ask", href: "/assistant", icon: MessageSquare },
  { name: "Notes", href: "/memories", icon: FileText, also: ["/search"] },
  { name: "Review", href: "/suggestions", icon: Inbox, also: ["/conflicts"] },
  { name: "Sync", href: "/sync", icon: RefreshCw, also: ["/activity"] },
];

// Items waiting on the user: share suggestions plus open sync conflicts
export function useReviewCount() {
  const { data: suggestions } = useQuery({
    queryKey: ["pending-suggestions"],
    queryFn: () => fetchEdge("/suggestions?status=pending"),
    refetchInterval: 4000,
  });
  const { data: conflicts } = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => fetchEdge("/conflicts"),
    refetchInterval: 5000,
  });
  const s = Array.isArray(suggestions) ? suggestions.length : 0;
  const c = Array.isArray(conflicts) ? conflicts.filter((x: any) => x.status === "open").length : 0;
  return { suggestions: s, conflicts: c, total: s + c };
}

export function Navbar() {
  const pathname = usePathname();
  const review = useReviewCount();

  const isActive = (item: NavItem) =>
    item.href === "/" ? pathname === "/" : [item.href, ...(item.also ?? [])].some((p) => pathname.startsWith(p));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="w-6 h-6 rounded-md bg-fg text-bg flex items-center justify-center">
                <Shield className="w-3.5 h-3.5" />
              </span>
              EdgeVault
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {NAV.map((item) => {
                const active = isActive(item);
                const badge = item.href === "/suggestions" ? review.total : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm transition-colors",
                      active ? "text-fg font-medium bg-subtle" : "text-muted hover:text-fg"
                    )}
                  >
                    {item.name}
                    {badge > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[11px] font-semibold flex items-center justify-center tabular-nums">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <StatusMenu />
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line bg-bg/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badge = item.href === "/suggestions" ? review.total : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors",
                  active ? "text-fg" : "text-faint"
                )}
              >
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {badge > 0 && (
                    <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-accent text-bg text-[10px] font-semibold flex items-center justify-center">
                      {badge}
                    </span>
                  )}
                </span>
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
