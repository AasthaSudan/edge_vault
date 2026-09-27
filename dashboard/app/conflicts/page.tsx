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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Conflict Resolution Inbox
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Review version discrepancies and semantic contradictions between offline edge devices.
        </p>
      </div>

      {/* Conflict List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="p-8 text-center rounded-xl border border-border bg-card text-muted-foreground text-xs">
            Loading conflict inbox...
          </div>
        ) : !conflicts || conflicts.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-border bg-card space-y-2">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-semibold text-foreground">
              Zero Conflicts Detected
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
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
                className={`rounded-xl border p-5 space-y-4 transition-all ${
                  isOpen
                    ? "border-amber-500/40 bg-card shadow-sm"
                    : "border-border bg-card/60 opacity-80"
                }`}
              >
                {/* Conflict Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`p-1.5 rounded-lg ${
                        isOpen
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-muted text-muted-foreground border border-border"
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase font-mono tracking-wider text-foreground">
                          {c.kind} Conflict
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                            isOpen
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          }`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        Memory ID: {c.memory_id}
                      </span>
                    </div>
                  </div>

                  <span className="text-[11px] font-mono text-muted-foreground">
                    {c.created_at
                      ? new Date(Number(c.created_at)).toLocaleTimeString()
                      : ""}
                  </span>
                </div>

                {/* Side by Side Diff */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Local version (Mine) */}
                  <div className="rounded-lg border border-sky-500/30 bg-sky-950/10 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-sky-400 font-mono">
                        LOCAL (This Device)
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        v{local.version} · {local.author || local.device_id}
                      </span>
                    </div>
                    <p className="text-xs text-foreground bg-background/50 p-2.5 rounded border border-border leading-relaxed">
                      {local.text}
                    </p>
                  </div>

                  {/* Remote version (Fleet) */}
                  <div className="rounded-lg border border-purple-500/30 bg-purple-950/10 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-purple-400 font-mono">
                        REMOTE (Fleet Server)
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        v{remote.version} · {remote.author || remote.device_id}
                      </span>
                    </div>
                    <p className="text-xs text-foreground bg-background/50 p-2.5 rounded border border-border leading-relaxed">
                      {remote.text}
                    </p>
                  </div>
                </div>

                {/* Merge Editor */}
                {isEditing && (
                  <div className="p-3 rounded-lg border border-border bg-background space-y-2">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5 text-primary" />
                      <span>Synthesized Merged Content:</span>
                    </label>
                    <textarea
                      rows={3}
                      value={mergedText}
                      onChange={(e) => setMergedText(e.target.value)}
                      className="w-full p-2.5 rounded bg-card border border-border text-xs focus:outline-none focus:border-primary text-foreground font-sans"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingConflictId(null)}
                        className="px-3 py-1 rounded text-xs border border-border hover:bg-muted text-muted-foreground"
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
                        className="px-3 py-1 rounded text-xs bg-primary text-primary-foreground font-semibold hover:bg-sky-400"
                      >
                        Confirm & Push Merge
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
                      className="px-3 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-xs font-semibold transition-colors"
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
                      className="px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-xs font-semibold transition-colors"
                    >
                      Keep Theirs (Remote)
                    </button>

                    <button
                      onClick={() => {
                        setEditingConflictId(c.id);
                        setMergedText(`${local.text}\n---\n${remote.text}`);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-sky-400 text-xs font-semibold transition-colors flex items-center gap-1.5"
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
