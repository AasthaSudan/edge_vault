"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { ServerStatsCard } from "@/components/ServerStatsCard";
import {
  Shield,
  Lock,
  Share2,
  Clock,
  HardDrive,
  Database,
  Search,
  RefreshCw,
  Bot,
  Sparkles,
  ArrowRight,
  Cpu,
} from "lucide-react";

export default function OverviewPage() {
  const { data: stats } = useQuery({
    queryKey: ["local-stats"],
    queryFn: () => fetchEdge("/stats/local"),
    refetchInterval: 3000,
  });

  const total = stats?.total || 0;
  const shareable = stats?.shareable || 0;
  const privatePoints = stats?.private || 0;
  const routine = stats?.routine || 0;

  const shareablePct = total > 0 ? Math.round((shareable / total) * 100) : 0;
  const privatePct = total > 0 ? Math.round((privatePoints / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Hero Header */}
      <div className="panel p-6 sm:p-8">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-slate-400 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Node active · Local vector engine ready</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            Offline-first memory, private by default.
          </h1>

          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            EdgeVault stores field maintenance notes locally on-device. An AI Memory Gate filters sensitive data
            into an isolated local shard, allowing only sanitized operational knowledge to synchronize with the fleet.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <Link
              href="/assistant"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors shadow-xs"
            >
              <Bot className="w-4 h-4" />
              <span>Ask Assistant</span>
            </Link>

            <Link
              href="/suggestions"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Review Proposals</span>
            </Link>

            <Link
              href="/memories"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Browse Notes</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Points */}
        <div className="panel p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Total Records</span>
            <HardDrive className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-1">
            {total}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Dual shards on disk
          </div>
        </div>

        {/* Shareable */}
        <div className="panel p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span>Shareable</span>
            </span>
            <Share2 className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-200 mt-1">
            {shareable}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {shareablePct}% · Synced to fleet
          </div>
        </div>

        {/* Private */}
        <div className="panel p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span>Private</span>
            </span>
            <Lock className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-200 mt-1">
            {privatePoints}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {privatePct}% · Air-gapped on disk
          </div>
        </div>

        {/* Routine */}
        <div className="panel p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Routine</span>
            </span>
            <Clock className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-200 mt-1">
            {routine}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            14-day TTL auto purge
          </div>
        </div>
      </div>

      {/* Architecture Flow Strip */}
      <div className="panel p-5">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
            Physical Shard Architecture
          </h3>
          <span className="text-[11px] font-mono text-slate-400">
            Dual independent Qdrant Edge instances
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-rose-400 font-mono text-[11px]">
              <Lock className="w-3.5 h-3.5" />
              <span>1. Private Shard (/private)</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Holds notes containing customer data, passcodes, and personal logs. Completely isolated from sync network calls.
            </p>
          </div>

          <div className="space-y-1.5 border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0 md:pl-4">
            <div className="flex items-center gap-1.5 font-semibold text-sky-400 font-mono text-[11px]">
              <Shield className="w-3.5 h-3.5" />
              <span>2. Gate v2 &amp; Split &amp; Share</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Context-aware triage with deterministic downgrade-only vetoes. Proposes sanitized facts from mixed notes for human review.
            </p>
          </div>

          <div className="space-y-1.5 border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0 md:pl-4">
            <div className="flex items-center gap-1.5 font-semibold text-indigo-400 font-mono text-[11px]">
              <Share2 className="w-3.5 h-3.5" />
              <span>3. Shared Shard (/shared)</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Only verified technical solutions enter the SQLite outbox. Push-before-pull sync replicates across devices.
            </p>
          </div>
        </div>
      </div>

      {/* Cloud Proof of Privacy Audit */}
      <ServerStatsCard />

      {/* Engine Specs */}
      <div className="panel p-5">
        <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-slate-400" />
          <span>Edge Engine Specifications</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[11px]">Vector Database</span>
            <span className="text-slate-200 font-semibold mt-0.5 block">
              Qdrant Edge 0.8.0
            </span>
          </div>
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[11px]">Dense Model</span>
            <span className="text-slate-200 font-semibold mt-0.5 block">
              BAAI/bge-small-en-v1.5 (384d)
            </span>
          </div>
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[11px]">Sparse Search</span>
            <span className="text-slate-200 font-semibold mt-0.5 block">
              Built-in BM25 (RRF k=60)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
