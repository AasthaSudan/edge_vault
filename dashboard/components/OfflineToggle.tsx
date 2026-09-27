"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { Wifi, WifiOff } from "lucide-react";

export function OfflineToggle() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: 2500,
  });

  const mutation = useMutation({
    mutationFn: (on: boolean) =>
      fetchEdge(`/sync/offline?on=${on}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });

  const isOffline = !!data?.forced_offline;
  const outboxDepth = data?.outbox_depth ?? 0;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full border border-border bg-card/80 backdrop-blur text-xs font-medium">
      <button
        onClick={() => mutation.mutate(!isOffline)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-full transition-all ${
          isOffline
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
        }`}
        title="Toggle simulated connectivity for offline demo"
      >
        {isOffline ? (
          <>
            <WifiOff className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>Simulated Offline</span>
          </>
        ) : (
          <>
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span>Online</span>
          </>
        )}
      </button>

      <div className="flex items-center gap-1.5 text-muted-foreground border-l border-border pl-3">
        <span>Outbox:</span>
        <span
          className={`px-1.5 py-0.5 rounded font-mono font-semibold ${
            outboxDepth > 0
              ? "bg-amber-500/20 text-amber-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {outboxDepth}
        </span>
      </div>
    </div>
  );
}
