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
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-slate-800 bg-slate-900 text-xs font-mono">
      <button
        onClick={() => mutation.mutate(!isOffline)}
        className={`flex items-center gap-1.5 transition-colors cursor-pointer ${
          isOffline
            ? "text-amber-400 hover:text-amber-300"
            : "text-emerald-400 hover:text-emerald-300"
        }`}
        title="Toggle simulated network disconnection"
      >
        {isOffline ? (
          <>
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline</span>
          </>
        ) : (
          <>
            <Wifi className="w-3.5 h-3.5" />
            <span>Online</span>
          </>
        )}
      </button>

      <span className="text-slate-600">|</span>

      <span className="text-slate-400 flex items-center gap-1">
        <span>Outbox:</span>
        <strong className={outboxDepth > 0 ? "text-amber-400" : "text-slate-300"}>
          {outboxDepth}
        </strong>
      </span>
    </div>
  );
}
