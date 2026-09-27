"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { ServerStatsCard } from "@/components/ServerStatsCard";
import {
  ShieldCheck,
  Lock,
  Share2,
  Clock,
  HardDrive,
  Cpu,
  ArrowRight,
  Database,
  Search,
  RefreshCw,
} from "lucide-react";

export default function OverviewPage() {
  const { data: stats } = useQuery({
    queryKey: ["local-stats"],
    queryFn: () => fetchEdge("/stats/local"),
    refetchInterval: 3000,
  });

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: 3000,
  });

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="rounded-2xl border border-border bg-gradient-to-r from-card via-card to-sky-950/20 p-6 sm:p-8 relative overflow-hidden">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-mono font-medium mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
            <span>QDRANT EDGE NODE ACTIVE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Private by default, intelligent when connected.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            EdgeVault stores field maintenance memories locally in two physical
            shards. An on-device AI Memory Gate enforces privacy before data
            ever touches the network.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <Link
              href="/memories"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-sky-400 transition-colors shadow-sm"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Inspect Memories</span>
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-foreground font-semibold text-xs hover:bg-muted transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search Playground</span>
            </Link>
            <Link
              href="/sync"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-foreground font-semibold text-xs hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync Status</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Local Storage Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Points */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-mono">TOTAL LOCAL</span>
            <HardDrive className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {stats?.total ?? 0}
          </div>
          <span className="text-[11px] text-muted-foreground">
            Points across dual shards
          </span>
        </div>

        {/* Shareable */}
        <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
          <div className="flex items-center justify-between text-sky-400 mb-2">
            <span className="text-xs font-mono">SHAREABLE (SHARED)</span>
            <Share2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold font-mono text-sky-300">
            {stats?.shareable ?? 0}
          </div>
          <span className="text-[11px] text-sky-400/70">
            Pushed to fleet when online
          </span>
        </div>

        {/* Private */}
        <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-4">
          <div className="flex items-center justify-between text-rose-400 mb-2">
            <span className="text-xs font-mono">PRIVATE (LOCAL ONLY)</span>
            <Lock className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-300">
            {stats?.private ?? 0}
          </div>
          <span className="text-[11px] text-rose-400/70">
            Never leaves device disk
          </span>
        </div>

        {/* Routine */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
          <div className="flex items-center justify-between text-amber-400 mb-2">
            <span className="text-xs font-mono">ROUTINE (TTL 14D)</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300">
            {stats?.routine ?? 0}
          </div>
          <span className="text-[11px] text-amber-400/70">
            Auto-purged status noise
          </span>
        </div>
      </div>

      {/* Cloud Fleet Verification Panel */}
      <ServerStatsCard />

      {/* Architecture Spec Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-sky-400" />
          <span>Active Edge Node Specifications</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded-lg bg-background/50 border border-border">
            <span className="text-muted-foreground block">Vector Engine:</span>
            <span className="text-foreground font-semibold">
              Qdrant Edge 0.8.0 (WAL-backed)
            </span>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border">
            <span className="text-muted-foreground block">Dense Embeddings:</span>
            <span className="text-foreground font-semibold">
              BAAI/bge-small-en-v1.5 (384-dim, Cosine)
            </span>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border">
            <span className="text-muted-foreground block">Sparse Embeddings:</span>
            <span className="text-foreground font-semibold">
              Qdrant Edge Built-in BM25 (IDF)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
