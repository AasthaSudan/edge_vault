"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { GateBadge } from "@/components/GateBadge";
import { Search, Zap, Layers, Hash, Clock, Cpu } from "lucide-react";

const DEMO_QUERIES = [
  "pump making noise",
  "P-200",
  "pump vibration after bearing change",
  "C-14 trips on high temp",
  "torque spec panel B",
];

export default function SearchPlayground() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "dense" | "bm25">("hybrid");
  const [assetTagFilter, setAssetTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const searchMutation = useMutation({
    mutationFn: (searchParams: any) =>
      fetchEdge("/search", {
        method: "POST",
        body: JSON.stringify(searchParams),
      }),
  });

  const handleSearch = (e?: React.FormEvent, customQuery?: string, customMode?: "hybrid" | "dense" | "bm25") => {
    if (e) e.preventDefault();
    const q = customQuery !== undefined ? customQuery : query;
    const m = customMode !== undefined ? customMode : mode;
    if (!q.trim()) return;

    searchMutation.mutate({
      q,
      mode: m,
      asset_tag: assetTagFilter || null,
      category: categoryFilter || null,
      limit: 10,
    });
  };

  const results = searchMutation.data?.results || [];
  const latency = searchMutation.data?.latency_ms;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Search Playground
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Execute offline hybrid search (Dense 384 + BM25 with RRF) across private and shared shards.
        </p>
      </div>

      {/* Query Bar & Controls */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
        <form onSubmit={(e) => handleSearch(e)} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a technical maintenance question (e.g. pump cavitation, P-200)..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-background border border-border text-xs focus:outline-none focus:border-primary text-foreground"
            />
          </div>

          <button
            type="submit"
            disabled={searchMutation.isPending || !query.trim()}
            className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-sky-400 transition-colors disabled:opacity-50 shrink-0"
          >
            {searchMutation.isPending ? "Searching..." : "Search"}
          </button>
        </form>

        {/* Quick Demo Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-muted-foreground text-[11px]">Demo queries:</span>
          {DEMO_QUERIES.map((dq) => (
            <button
              key={dq}
              type="button"
              onClick={() => {
                setQuery(dq);
                handleSearch(undefined, dq);
              }}
              className="px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] border border-border transition-colors font-mono"
            >
              {dq}
            </button>
          ))}
        </div>

        {/* Mode Switcher & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-background border border-border">
            <button
              type="button"
              onClick={() => {
                setMode("hybrid");
                if (query) handleSearch(undefined, undefined, "hybrid");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                mode === "hybrid"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Hybrid (RRF)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("dense");
                if (query) handleSearch(undefined, undefined, "dense");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                mode === "dense"
                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Dense Only</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("bm25");
                if (query) handleSearch(undefined, undefined, "bm25");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                mode === "bm25"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              <span>BM25 Only</span>
            </button>
          </div>

          {/* Asset tag filter */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={assetTagFilter}
              onChange={(e) => setAssetTagFilter(e.target.value)}
              placeholder="Filter asset tag..."
              className="px-2.5 py-1 rounded bg-background border border-border text-xs font-mono uppercase focus:outline-none focus:border-primary w-32"
            />
          </div>
        </div>
      </div>

      {/* Latency & Results Banner */}
      {latency && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-card border border-border text-xs font-mono">
          <div className="flex items-center gap-4 text-muted-foreground">
            <span>
              Returned: <strong className="text-foreground">{results.length}</strong> hits
            </span>
            <span>
              Mode: <strong className="text-primary uppercase">{mode}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Cpu className="w-3 h-3 text-sky-400" />
              <span>Embed: <strong>{latency.embed} ms</strong></span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Search: <strong>{latency.search} ms</strong></span>
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold">
              <Clock className="w-3 h-3" />
              <span>Total: {latency.total} ms</span>
            </span>
          </div>
        </div>
      )}

      {/* Results List */}
      <div className="space-y-3">
        {results.length > 0 ? (
          results.map((hit: any, idx: number) => (
            <div
              key={hit.id}
              className="rounded-xl border border-border bg-card p-4 hover:border-border/80 transition-all space-y-2 group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-muted font-mono font-bold text-[11px] flex items-center justify-center text-muted-foreground">
                    #{idx + 1}
                  </span>
                  {hit.title && (
                    <span className="font-semibold text-xs text-foreground">
                      {hit.title}
                    </span>
                  )}
                  {hit.asset_tag && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono font-semibold text-foreground border border-border">
                      {hit.asset_tag}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    score: <strong className="text-sky-400 font-semibold">{hit.score}</strong>
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {hit.text}
              </p>

              <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[11px]">
                <GateBadge
                  category={hit.category}
                  source={hit.gate_source}
                  reason={hit.gate_reason}
                  piiHits={hit.pii_hits}
                />
                <span className="font-mono text-muted-foreground/60 text-[10px]">
                  Origin: {hit.device_id || "device-a"} · v{hit.version || 1}
                </span>
              </div>
            </div>
          ))
        ) : searchMutation.isSuccess ? (
          <div className="p-8 text-center rounded-xl border border-border bg-card text-muted-foreground text-xs">
            No memories matched your query or filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}
