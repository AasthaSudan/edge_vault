"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCloud } from "@/lib/api";
import { ShieldCheck, Cloud, AlertCircle, RefreshCw } from "lucide-react";

export function ServerStatsCard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cloud-stats"],
    queryFn: () => fetchCloud("/stats"),
    refetchInterval: 3000,
  });

  return (
    <div className="rounded-xl border border-sky-500/30 bg-card p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/5 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Cloud className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Cloud Fleet Verification (Proof of Privacy)
            </h3>
            <p className="text-xs text-muted-foreground">
              Live audit from Qdrant Server & Cloud Sync API (:8080/stats)
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh server stats"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {isError ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Cloud Sync API unreachable (:8080). Make sure cloud container is up.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div className="p-3 rounded-lg bg-background/50 border border-border">
            <span className="text-[11px] font-mono text-muted-foreground block">
              TOTAL POINTS
            </span>
            <span className="text-xl font-bold font-mono text-foreground mt-0.5 block">
              {data?.total ?? 0}
            </span>
            <span className="text-[10px] text-muted-foreground">Fleet memories</span>
          </div>

          <div className="p-3 rounded-lg bg-sky-950/20 border border-sky-500/30">
            <span className="text-[11px] font-mono text-sky-400 block">
              SHAREABLE
            </span>
            <span className="text-xl font-bold font-mono text-sky-300 mt-0.5 block">
              {data?.shareable_on_server ?? 0}
            </span>
            <span className="text-[10px] text-sky-400/80">Synced fleet fixes</span>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border">
            <span className="text-[11px] font-mono text-muted-foreground block">
              PRIVATE ON SERVER
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`text-xl font-bold font-mono ${
                  data?.private_on_server === 0
                    ? "text-emerald-400"
                    : "text-rose-400 animate-pulse"
                }`}
              >
                {data?.private_on_server ?? 0}
              </span>
              {data?.private_on_server === 0 && (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <span className="text-[10px] text-emerald-400/80">
              Must read 0 (Strict)
            </span>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border">
            <span className="text-[11px] font-mono text-muted-foreground block">
              ROUTINE ON SERVER
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`text-xl font-bold font-mono ${
                  data?.routine_on_server === 0
                    ? "text-emerald-400"
                    : "text-rose-400 animate-pulse"
                }`}
              >
                {data?.routine_on_server ?? 0}
              </span>
              {data?.routine_on_server === 0 && (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <span className="text-[10px] text-emerald-400/80">
              Must read 0 (Strict)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
