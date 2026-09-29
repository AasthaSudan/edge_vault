"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OfflineToggle } from "./OfflineToggle";
import { LlmStatus } from "./LlmStatus";
import {
  Shield,
  Layers,
  Bot,
  Sparkles,
  Database,
  Search,
  RefreshCw,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";

const NAV_ITEMS = [
  { name: "Overview", href: "/", icon: Layers },
  { name: "Assistant", href: "/assistant", icon: Bot },
  { name: "Split & Share", href: "/suggestions", icon: Sparkles, badge: true },
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

  const { data: pendingSuggestions } = useQuery({
    queryKey: ["pending-suggestions"],
    queryFn: () => fetchEdge("/suggestions?status=pending"),
    refetchInterval: 4000,
  });

  const suggestionsCount = Array.isArray(pendingSuggestions) ? pendingSuggestions.length : 0;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[#090d16]/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400 group-hover:text-white transition-colors">
              <Shield className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-tight text-white">
                EdgeVault
              </span>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline-block">
                /{health?.device_id || "device-a"}
              </span>
            </div>
          </Link>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                  isActive
                    ? "bg-slate-800 text-white font-medium shadow-xs"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.name}</span>
                {item.badge && suggestionsCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-sky-600 text-white font-mono text-[10px] font-semibold">
                    {suggestionsCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right Controls */}
        <div className="flex items-center gap-2">
          <LlmStatus />
          <OfflineToggle />
        </div>
      </div>
    </header>
  );
}
