"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import {
  AlertTriangle,
  CheckCircle,
  GitMerge,
  ArrowRight,
  ShieldAlert,
  Edit3,
  Loader2,
  Sparkles,
} from "lucide-react";

type Analysis = {
  relation: "progression" | "contradiction" | "same_fact" | "unknown";
  explanation: string;
  recommendation: "keep_local" | "keep_remote" | "merge";
  merged_text: string;
  source: string;
  value_differences?: string[];
  ms?: number;
};

const RELATION_STYLE: Record<string, { label: string; cls: string }> = {
  progression: { label: "Progression over time", cls: "bg-sky-950/40 text-sky-300 border-sky-800/50" },
  contradiction: { label: "Genuine contradiction", cls: "bg-rose-950/40 text-rose-300 border-rose-800/50" },
  same_fact: { label: "Same fact, reworded", cls: "bg-emerald-950/40 text-emerald-300 border-emerald-800/50" },
  unknown: { label: "Model unavailable", cls: "bg-slate-800/60 text-slate-300 border-slate-700" },
};

const ACTION_LABEL: Record<string, string> = {
  keep_local: "Keep Mine (Local)",
  keep_remote: "Keep Theirs (Remote)",
  merge: "Merge Notes",
};

// On-device LLM reconciliation for one conflict. Cached on the edge after the first run.
function useAnalysis(c: any) {
  return useQuery<Analysis>({
    queryKey: ["conflict-analysis", c.id],
    queryFn: () => fetchEdge(`/conflicts/${c.id}/analyze`, { method: "POST" }),
    initialData: c.analysis ?? undefined,
    enabled: c.status === "open" && !c.analysis,
    staleTime: Infinity,
    retry: false,
  });
}

function AnalysisBanner({ a, loading }: { a?: Analysis; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-indigo-900/50 bg-indigo-950/20 text-xs text-indigo-300">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Reconciling the two reports on this device…</span>
      </div>
    );
  }
  if (!a) return null;
  const style = RELATION_STYLE[a.relation] ?? RELATION_STYLE.unknown;
  return (
    <div className="p-3 rounded-lg border border-indigo-900/50 bg-indigo-950/20 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200 font-mono">
          AI Reconciliation
        </span>
        <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase ${style.cls}`}>
          {style.label}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {a.source === "fallback" ? "rules only" : "on-device model"}
          {a.ms ? ` · ${(a.ms / 1000).toFixed(1)} s` : ""}
        </span>
      </div>
      <p className="text-xs text-slate-200 leading-relaxed">{a.explanation}</p>
      {a.value_differences && a.value_differences.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.value_differences.map((d) => (
            <span key={d} className="px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-800/40 text-rose-300 text-[10px] font-mono">
              {d}
            </span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Recommended: <span className="text-white font-medium">{ACTION_LABEL[a.recommendation]}</span>
        <span className="text-slate-500"> · advisory, you decide</span>
      </p>
    </div>
  );
}

function ConflictAnalysis({ c, children }: { c: any; children: (a?: Analysis) => React.ReactNode }) {
  const { data, isFetching } = useAnalysis(c);
  return (
    <>
      {c.status === "open" && <AnalysisBanner a={data} loading={isFetching && !data} />}
      {children(data)}
    </>
  );
}

export default function ConflictsPage() {
  const qc = useQueryClient();
  const [editingConflictId, setEditingConflictId] = useState<string | null>(null);
  const [mergedText, setMergedText] = useState<string>("");

  const { data: conflicts, isLoading } = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => fetchEdge("/conflicts"),
    refetchInterval: 3000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      conflictId,
      resolution,
      text,
    }: {
      conflictId: string;
      resolution: string;
      text?: string;
    }) =>
      fetchEdge(`/conflicts/${conflictId}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          resolution,
          merged_text: text || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conflicts"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      setEditingConflictId(null);
      setMergedText("");
    },
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
            Conflict Resolution Inbox
          </h1>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">
            Branch &amp; Merge
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Review version discrepancies and concurrent conflicting edits between offline edge nodes.
        </p>
      </div>

      {/* Conflict List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="panel p-12 text-center text-slate-500 text-xs font-mono">
            Loading conflict inbox...
          </div>
        ) : !conflicts || conflicts.length === 0 ? (
          <div className="panel p-12 text-center space-y-2">
            <CheckCircle className="w-6 h-6 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-semibold text-white">
              Zero Conflicts Detected
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              All edge devices have converged cleanly or have not encountered concurrent contradictory edits.
            </p>
          </div>
        ) : (
          conflicts.map((c: any) => {
            const isOpen = c.status === "open";
            const local = c.local || {};
            const remote = c.remote || {};
            const isEditing = editingConflictId === c.id;

            return (
              <div
                key={c.id}
                className="panel p-4 sm:p-5 space-y-4"
              >
                {/* Conflict Header */}
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-white">
                          {c.kind} Conflict
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-medium border ${
                            isOpen
                              ? "bg-amber-950/30 text-amber-400 border-amber-800/40"
                              : "bg-emerald-950/30 text-emerald-400 border-emerald-800/40"
                          }`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        Memory ID: {c.memory_id}
                      </span>
                    </div>
                  </div>

                  <span className="text-[11px] font-mono text-slate-500">
                    {c.created_at
                      ? new Date(Number(c.created_at)).toLocaleTimeString()
                      : ""}
                  </span>
                </div>

                {/* Side by Side Diff */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Local version (Mine) */}
                  <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-sky-400 font-mono text-[11px]">
                        LOCAL (This Device)
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        v{local.version} · {local.author || local.device_id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 bg-slate-950 p-2.5 rounded border border-slate-800/80 leading-relaxed font-mono">
                      {local.text}
                    </p>
                  </div>

                  {/* Remote version (Fleet) */}
                  <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-indigo-400 font-mono text-[11px]">
                        REMOTE (Fleet Server)
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        v{remote.version} · {remote.author || remote.device_id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 bg-slate-950 p-2.5 rounded border border-slate-800/80 leading-relaxed font-mono">
                      {remote.text}
                    </p>
                  </div>
                </div>

                <ConflictAnalysis c={c}>
                {(a) => (<>
                {/* Merge Editor */}
                {isEditing && (
                  <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950 space-y-3">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5 text-sky-400" />
                      <span>Synthesized Merged Content:</span>
                    </label>
                    <textarea
                      rows={3}
                      value={mergedText}
                      onChange={(e) => setMergedText(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 font-mono leading-relaxed"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingConflictId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() =>
                          resolveMutation.mutate({
                            conflictId: c.id,
                            resolution: "merged",
                            text: mergedText,
                          })
                        }
                        className="px-3.5 py-1.5 rounded-lg text-xs bg-sky-600 hover:bg-sky-500 text-white font-medium transition-colors cursor-pointer shadow-xs"
                      >
                        Confirm &amp; Push Merge
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                {isOpen && !isEditing && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() =>
                        resolveMutation.mutate({
                          conflictId: c.id,
                          resolution: "keep_local",
                        })
                      }
                      disabled={resolveMutation.isPending}
                      className={`px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer${a?.recommendation === "keep_local" ? " ring-1 ring-indigo-400 text-white" : ""}`}
                    >
                      Keep Mine (Local)
                    </button>

                    <button
                      onClick={() =>
                        resolveMutation.mutate({
                          conflictId: c.id,
                          resolution: "keep_remote",
                        })
                      }
                      disabled={resolveMutation.isPending}
                      className={`px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer${a?.recommendation === "keep_remote" ? " ring-1 ring-indigo-400 text-white" : ""}`}
                    >
                      Keep Theirs (Remote)
                    </button>

                    <button
                      onClick={() => {
                        setEditingConflictId(c.id);
                        // Pre-fill with the model's grounded merge when it proposed one
                        setMergedText(a?.merged_text || `${local.text}\n---\n${remote.text}`);
                      }}
                      className={`px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs${a?.recommendation === "merge" ? " ring-2 ring-indigo-300" : ""}`}
                    >
                      <GitMerge className="w-3.5 h-3.5" />
                      <span>Merge Notes</span>
                    </button>
                  </div>
                )}
                </>)}
                </ConflictAnalysis>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
