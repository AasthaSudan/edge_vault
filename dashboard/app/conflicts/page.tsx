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
} from "lucide-react";

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
                      className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
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
                      className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
                    >
                      Keep Theirs (Remote)
                    </button>

                    <button
                      onClick={() => {
                        setEditingConflictId(c.id);
                        setMergedText(`${local.text}\n---\n${remote.text}`);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <GitMerge className="w-3.5 h-3.5" />
                      <span>Merge Notes</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
