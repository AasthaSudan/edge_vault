"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { ServerStatsCard } from "@/components/ServerStatsCard";
import {
  RefreshCw,
  Clock,
  Send,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export default function SyncPage() {
  const qc = useQueryClient();

  const { data: syncStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: 2500,
  });

  const { data: outboxRows, isLoading: outboxLoading } = useQuery({
    queryKey: ["outbox"],
    queryFn: () => fetchEdge("/sync/outbox"),
    refetchInterval: 2500,
  });

  const syncNowMutation = useMutation({
    mutationFn: () => fetchEdge("/sync/now", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      qc.invalidateQueries({ queryKey: ["outbox"] });
      qc.invalidateQueries({ queryKey: ["cloud-stats"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Synchronization & Fleet Status
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Durable SQLite outbox queue, background sync worker, and cloud verification.
          </p>
        </div>

        <button
          onClick={() => syncNowMutation.mutate()}
          disabled={syncNowMutation.isPending || syncStatus?.forced_offline}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-sky-400 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              syncNowMutation.isPending ? "animate-spin" : ""
            }`}
          />
          <span>{syncNowMutation.isPending ? "Syncing..." : "Sync Now"}</span>
        </button>
      </div>

      {/* Cloud Proof of Privacy Panel */}
      <ServerStatsCard />

      {/* Sync Timeline & Worker Diagnostics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs">
            <Send className="w-3.5 h-3.5 text-sky-400" />
            <span>Last Fleet Push</span>
          </div>
          <div className="text-sm font-semibold font-mono text-foreground">
            {syncStatus?.last_push_at
              ? new Date(Number(syncStatus.last_push_at)).toLocaleTimeString()
              : "Never"}
          </div>
          <span className="text-[10px] text-muted-foreground">
            Pushes pending outbox batches
          </span>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs">
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Last Fleet Pull</span>
          </div>
          <div className="text-sm font-semibold font-mono text-foreground">
            {syncStatus?.last_pull_at
              ? new Date(Number(syncStatus.last_pull_at)).toLocaleTimeString()
              : "Never"}
          </div>
          <span className="text-[10px] text-muted-foreground">
            Pulls partial delta snapshots
          </span>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Outbox Depth</span>
          </div>
          <div className="text-sm font-semibold font-mono text-foreground">
            {syncStatus?.outbox_depth ?? 0} items
          </div>
          <span className="text-[10px] text-muted-foreground">
            Queued for transmission
          </span>
        </div>
      </div>

      {/* Outbox Queue Inspector */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Local Outbox Queue (`edge.db`)
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Durable SQLite table that survives crashes and restarts. Drained only when online.
            </p>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">
            {outboxRows?.length ?? 0} entries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 font-mono text-muted-foreground">
                <th className="p-3 w-16">ID</th>
                <th className="p-3">Memory ID</th>
                <th className="p-3 w-24">Operation</th>
                <th className="p-3 w-28">Status</th>
                <th className="p-3 w-24">Version</th>
                <th className="p-3 w-24">Attempts</th>
                <th className="p-3 w-36">Enqueued</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono text-[11px]">
              {outboxLoading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Loading outbox...
                  </td>
                </tr>
              ) : !outboxRows || outboxRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Outbox is empty. All shareable memories have synced!
                  </td>
                </tr>
              ) : (
                outboxRows.map((row: any) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="p-3 font-semibold text-foreground">#{row.id}</td>
                    <td className="p-3 text-muted-foreground truncate max-w-xs">
                      {row.memory_id}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          row.op === "upsert"
                            ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {row.op}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          row.status === "done"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : row.status === "pending"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : row.status === "inflight"
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      v{row.version} (base {row.base_version})
                    </td>
                    <td className="p-3 text-muted-foreground">{row.attempts}</td>
                    <td className="p-3 text-muted-foreground">
                      {row.created_at
                        ? new Date(Number(row.created_at)).toLocaleTimeString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
