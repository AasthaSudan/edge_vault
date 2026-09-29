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

  const isVerified = data?.private_on_server === 0 && data?.routine_on_server === 0;

  return (
    <div className="panel p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Cloud className="w-4 h-4 text-sky-400" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                Cloud Verification (Proof of Privacy)
              </h3>
              {isVerified && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Audit Passed</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Live audit from central Qdrant cluster (:8080/stats)
            </p>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {isError ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-300 text-xs font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>Cloud Sync API unreachable (:8080).</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-500 uppercase block">
              Fleet Total
            </span>
            <span className="text-xl font-bold font-mono text-white mt-0.5 block">
              {data?.total ?? 0}
            </span>
            <span className="text-[10px] text-slate-500">Central cloud records</span>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800/80">
            <span className="text-[11px] font-mono text-sky-400 uppercase block">
              Shareable
            </span>
            <span className="text-xl font-bold font-mono text-slate-200 mt-0.5 block">
              {data?.shareable_on_server ?? 0}
            </span>
            <span className="text-[10px] text-slate-500">Synced procedures</span>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-500 uppercase block">
              Private on Server
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`text-xl font-bold font-mono ${
                  data?.private_on_server === 0
                    ? "text-emerald-400"
                    : "text-rose-400 font-bold"
                }`}
              >
                {data?.private_on_server ?? 0}
              </span>
              {data?.private_on_server === 0 && (
                <span className="text-[10px] font-mono text-emerald-400">(0 leaked)</span>
              )}
            </div>
            <span className="text-[10px] text-slate-500">Strict zero target</span>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-500 uppercase block">
              Routine on Server
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`text-xl font-bold font-mono ${
                  data?.routine_on_server === 0
                    ? "text-emerald-400"
                    : "text-rose-400 font-bold"
                }`}
              >
                {data?.routine_on_server ?? 0}
              </span>
              {data?.routine_on_server === 0 && (
                <span className="text-[10px] font-mono text-emerald-400">(0 leaked)</span>
              )}
            </div>
            <span className="text-[10px] text-slate-500">Local TTL only</span>
          </div>
        </div>
      )}
    </div>
  );
}
