"use client";

import React, { useState } from "react";
import { useEdgeEvents } from "@/lib/sse";
import { EDGE_API } from "@/lib/api";
import {
  Activity,
  Radio,
  Filter,
  Trash2,
  Cpu,
  Layers,
  CheckCircle,
  AlertTriangle,
  RotateCw,
} from "lucide-react";

export default function ActivityPage() {
  const events = useEdgeEvents(EDGE_API);
  const [filterType, setFilterType] = useState<string>("all");

  const filteredEvents = events.filter((ev) => {
    if (filterType === "all") return true;
    return ev.type.startsWith(filterType);
  });

  const getEventBadge = (type: string) => {
    if (type.startsWith("memory.")) {
      return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    }
    if (type.startsWith("gate.")) {
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    }
    if (type.startsWith("sync.")) {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    }
    if (type.startsWith("conflict.")) {
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    }
    if (type.startsWith("dedup.")) {
      return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
    }
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Real-Time Activity Stream
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live Server-Sent Events (SSE) from the local edge node (:7001/events).
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-medium">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>SSE CONNECTED</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "memory", "gate", "sync", "conflict", "dedup"].map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
                filterType === f
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="text-xs font-mono text-muted-foreground">
          Showing {filteredEvents.length} events
        </span>
      </div>

      {/* Stream Feed */}
      <div className="space-y-2.5">
        {filteredEvents.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-border bg-card space-y-2">
            <Activity className="w-8 h-8 text-muted-foreground mx-auto" />
            <h3 className="text-sm font-semibold text-foreground">
              Awaiting Edge Events...
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Perform an action (create a note, trigger search, toggle offline mode, or sync) to watch events stream in real time.
            </p>
          </div>
        ) : (
          filteredEvents.map((ev, i) => (
            <div
              key={`${ev.ts}-${i}`}
              className="p-3.5 rounded-lg border border-border bg-card hover:border-border/80 transition-all font-mono text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3 animate-in fade-in duration-150"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getEventBadge(
                      ev.type
                    )}`}
                  >
                    {ev.type}
                  </span>
                  {ev.memory_id && (
                    <span className="text-muted-foreground text-[10px] truncate max-w-xs">
                      mid: {ev.memory_id}
                    </span>
                  )}
                </div>

                {ev.data && Object.keys(ev.data).length > 0 && (
                  <pre className="text-[11px] text-muted-foreground bg-background/50 p-2 rounded border border-border overflow-x-auto">
                    {JSON.stringify(ev.data, null, 2)}
                  </pre>
                )}
              </div>

              <span className="text-[10px] text-muted-foreground/60 shrink-0 self-start">
                {new Date(ev.ts).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
