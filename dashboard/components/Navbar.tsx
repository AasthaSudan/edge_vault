"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OfflineToggle } from "./OfflineToggle";
import {
  ShieldCheck,
  Database,
  Search,
  RefreshCw,
  AlertTriangle,
  Activity,
  Layers,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";

const NAV_ITEMS = [
  { name: "Overview", href: "/", icon: Layers },
  { name: "Memories", href: "/memories", icon: Database },
  { name: "Search", href: "/search", icon: Search },
  { name: "Sync", href: "/sync", icon: RefreshCw },
  { name: "Conflicts", href: "/conflicts", icon: AlertTriangle },
  { name: "Activity", href: "/activity", icon: Activity },
];

export function Navbar() {
  const pathname = usePathname();

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchEdge("/health"),
    refetchInterval: 5000,
  });

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 group-hover:border-sky-400 transition-colors">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-sm text-foreground">
                EdgeVault
              </span>
              <span className="hidden sm:inline-block ml-2 text-[11px] font-mono text-muted-foreground border-l border-border pl-2">
                {health?.device_id || "device-a"}
              </span>
            </div>
          </Link>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right side status & offline toggle */}
        <div className="flex items-center gap-2">
          <OfflineToggle />
        </div>
      </div>
    </header>
  );
}
