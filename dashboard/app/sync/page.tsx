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
  const [syncMessage, setSyncMessage] = React.useState<{ type: "success" | "info" | "warning"; text: string } | null>(null);

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
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      qc.invalidateQueries({ queryKey: ["outbox"] });
      qc.invalidateQueries({ queryKey: ["cloud-stats"] });
      qc.invalidateQueries({ queryKey: ["memories"] });

      if (data?.status === "skipped") {
        setSyncMessage({ type: "warning", text: `Sync skipped: ${data.reason || "Device offline"}` });
      } else if (data?.pushed > 0) {
        setSyncMessage({ type: "success", text: `Success! Pushed ${data.pushed} pending memory to central fleet and pulled latest updates.` });
      } else {
        setSyncMessage({ type: "info", text: "Fleet is completely up-to-date! (0 pending records in outbox)." });
      }
    },
    onError: (err: any) => {
      setSyncMessage({ type: "warning", text: `Sync error: ${err.message || "Failed to reach server"}` });
    },
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Synchronization &amp; Fleet Status
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">
              Push-Before-Pull
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Durable SQLite outbox queue, background sync worker, and live cloud verification audit.
          </p>
        </div>

        <button
          onClick={() => syncNowMutation.mutate()}
          disabled={syncNowMutation.isPending || syncStatus?.forced_offline}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors disabled:opacity-40 self-start sm:self-auto cursor-pointer shadow-xs"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              syncNowMutation.isPending ? "animate-spin" : ""
            }`}
          />
          <span>{syncNowMutation.isPending ? "Syncing Fleet..." : "Sync Fleet Now"}</span>
        </button>
      </div>

      {/* Sync Status Banner */}
      {syncMessage && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-lg border text-xs font-mono transition-all ${
            syncMessage.type === "success"
              ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-400"
              : syncMessage.type === "warning"
              ? "bg-amber-950/30 border-amber-800/40 text-amber-400"
              : "bg-sky-950/30 border-sky-800/40 text-sky-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {syncMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-sky-400" />
            )}
            <span>{syncMessage.text}</span>
          </div>
          <button
            onClick={() => setSyncMessage(null)}
            className="text-slate-400 hover:text-white text-[11px] underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Cloud Proof of Privacy Panel */}
      <ServerStatsCard />

      {/* Sync Timeline & Worker Diagnostics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="panel p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1 text-xs">
            <Send className="w-3.5 h-3.5 text-sky-400" />
            <span>Last Fleet Push</span>
          </div>
          <div className="text-sm font-semibold font-mono text-white mt-1">
            {syncStatus?.last_push_at
              ? new Date(Number(syncStatus.last_push_at)).toLocaleTimeString()
              : "Never"}
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            Pushes pending outbox batches
          </span>
        </div>

        <div className="panel p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1 text-xs">
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Last Fleet Pull</span>
          </div>
          <div className="text-sm font-semibold font-mono text-white mt-1">
            {syncStatus?.last_pull_at
              ? new Date(Number(syncStatus.last_pull_at)).toLocaleTimeString()
              : "Never"}
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            Pulls partial delta snapshots
          </span>
        </div>

        <div className="panel p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1 text-xs">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Outbox Depth</span>
          </div>
          <div className="text-sm font-semibold font-mono text-white mt-1">
            {syncStatus?.outbox_depth ?? 0} items
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            Queued for transmission
          </span>
        </div>
      </div>

      {/* Outbox Queue Inspector */}
      <div className="panel overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
              Local Outbox Queue (edge.db)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Durable SQLite table that survives crashes and restarts. Drained only when online.
            </p>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
            {outboxRows?.length ?? 0} entries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-slate-900/50 font-mono text-slate-400 uppercase text-[10px] tracking-wider">
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
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    Loading outbox...
                  </td>
                </tr>
              ) : !outboxRows || outboxRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    Outbox is empty. All shareable memories have synced!
                  </td>
                </tr>
              ) : (
                outboxRows.map((row: any) => (
                  <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 font-semibold text-slate-200">#{row.id}</td>
                    <td className="p-3 text-slate-400 truncate max-w-xs">
                      {row.memory_id}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                          row.op === "upsert"
                            ? "bg-sky-950/30 text-sky-400 border-sky-800/40"
                            : "bg-rose-950/30 text-rose-400 border-rose-800/40"
                        }`}
                      >
                        {row.op}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${
                          row.status === "done"
                            ? "bg-emerald-950/30 text-emerald-400 border-emerald-800/40"
                            : row.status === "pending"
                            ? "bg-amber-950/30 text-amber-400 border-amber-800/40"
                            : row.status === "inflight"
                            ? "bg-purple-950/30 text-purple-400 border-purple-800/40"
                            : "bg-rose-950/30 text-rose-400 border-rose-800/40"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">
                      v{row.version} (base {row.base_version})
                    </td>
                    <td className="p-3 text-slate-400">{row.attempts}</td>
                    <td className="p-3 text-slate-400">
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
