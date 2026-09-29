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
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Real-Time Activity Stream
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">
              SSE Telemetry
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Live Server-Sent Events emitted by the local edge node (:7001/events).
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 text-xs font-mono font-medium">
            <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
            <span>Connected</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="panel p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {["all", "memory", "gate", "sync", "conflict", "dedup"].map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                filterType === f
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="text-xs font-mono text-slate-500">
          Showing {filteredEvents.length} events
        </span>
      </div>

      {/* Stream Feed */}
      <div className="space-y-2.5">
        {filteredEvents.length === 0 ? (
          <div className="panel p-12 text-center space-y-2">
            <Activity className="w-8 h-8 text-slate-600 mx-auto" />
            <h3 className="text-sm font-semibold text-white">
              Awaiting Edge Events...
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Perform an action (create a note, trigger search, toggle offline mode, or sync) to watch events stream in real time.
            </p>
          </div>
        ) : (
          filteredEvents.map((ev, i) => (
            <div
              key={`${ev.ts}-${i}`}
              className="panel p-3.5 font-mono text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase border ${getEventBadge(
                      ev.type
                    )}`}
                  >
                    {ev.type}
                  </span>
                  {ev.memory_id && (
                    <span className="text-slate-500 text-[10px] truncate max-w-xs">
                      mid: {ev.memory_id}
                    </span>
                  )}
                </div>

                {ev.data && Object.keys(ev.data).length > 0 && (
                  <pre className="text-[11px] text-slate-300 bg-slate-950 p-2.5 rounded border border-slate-800/80 overflow-x-auto leading-relaxed">
                    {JSON.stringify(ev.data, null, 2)}
                  </pre>
                )}
              </div>

              <span className="text-[10px] text-slate-500 shrink-0 self-start">
                {new Date(ev.ts).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
