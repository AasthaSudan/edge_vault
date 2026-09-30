"use client";

import React, { useState, useEffect, useRef } from "react";
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
  ChevronDown,
  Menu,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";

const PRIMARY_NAV = [
  { name: "Overview", href: "/", icon: Layers },
  { name: "Assistant", href: "/assistant", icon: Bot },
  { name: "Memories", href: "/memories", icon: Database },
  { name: "Proposals", href: "/suggestions", icon: Sparkles, badge: true },
  { name: "Sync", href: "/sync", icon: RefreshCw },
];

const MORE_NAV = [
  { name: "Search", href: "/search", icon: Search, desc: "Hybrid dense & sparse search" },
  { name: "Conflicts", href: "/conflicts", icon: AlertTriangle, desc: "Version branch & merge" },
  { name: "Activity", href: "/activity", icon: Activity, desc: "Real-time SSE event stream" },
];

export function Navbar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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
  const isMoreActive = MORE_NAV.some((item) => item.href === pathname);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setMoreOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[#090d16]/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/" className="flex items-center gap-2 group whitespace-nowrap">
            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400 group-hover:text-white transition-colors shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-white">
              EdgeVault
            </span>
          </Link>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hidden sm:inline-block shrink-0">
            {health?.device_id || "device-a"}
          </span>
        </div>

        {/* Desktop Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 shrink-0">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-slate-800 text-white font-medium shadow-xs"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.name}</span>
                {item.badge && suggestionsCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-sky-600 text-white font-mono text-[10px] font-semibold leading-none">
                    {suggestionsCount}
                  </span>
                )}
              </Link>
            );
          })}

          {/* More Dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors cursor-pointer ${
                isMoreActive || moreOpen
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <span>More</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-150 ${
                  moreOpen ? "rotate-180 text-white" : "text-slate-500"
                }`}
              />
            </button>

            {moreOpen && (
              <div className="absolute left-0 mt-1.5 w-48 rounded-lg border border-slate-800 bg-[#0c121e] shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                {MORE_NAV.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-start gap-2.5 px-3 py-2 text-xs transition-colors ${
                        isActive
                          ? "bg-slate-800 text-white font-medium"
                          : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 mt-0.5 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-medium text-slate-200 leading-none">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 leading-tight">
                          {item.desc}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Right Controls & Mobile Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <LlmStatus />
          <OfflineToggle />

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Panel */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#090d16] px-4 py-3 space-y-1">
          {[...PRIMARY_NAV, ...MORE_NAV].map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/40 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-sky-400" />
                  <span>{item.name}</span>
                </div>
                {item.badge && suggestionsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-sky-600 text-white font-mono text-[10px] font-semibold">
                    {suggestionsCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
