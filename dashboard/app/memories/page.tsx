"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { GateBadge } from "@/components/GateBadge";
import {
  Plus,
  Trash2,
  Edit2,
  ArrowRightLeft,
  Search,
  Filter,
  RefreshCw,
  Sparkles,
} from "lucide-react";

function errorDetail(err: Error): string {
  try {
    return JSON.parse(err.message).detail ?? err.message;
  } catch {
    return err.message;
  }
}

export default function MemoriesPage() {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [assetFilter, setAssetFilter] = useState<string>("");
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form state
  const [formText, setFormText] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formAsset, setFormAsset] = useState("");
  const [formCategory, setFormCategory] = useState("auto");

  // Query memories
  const { data: memories, isLoading, refetch } = useQuery({
    queryKey: ["memories", categoryFilter, assetFilter],
    queryFn: () => {
      let query = "/memories?limit=100";
      if (categoryFilter) query += `&category=${categoryFilter}`;
      if (assetFilter) query += `&asset_tag=${encodeURIComponent(assetFilter)}`;
      return fetchEdge(query);
    },
    refetchInterval: 3000,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (newMemory: any) =>
      fetchEdge("/memories", {
        method: "POST",
        body: JSON.stringify(newMemory),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["local-stats"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      setIsAddOpen(false);
      setFormText("");
      setFormTitle("");
      setFormAsset("");
      setFormCategory("auto");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetchEdge(`/memories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["local-stats"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });

  // Category Override mutation (retraction / relocation)
  const overrideMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      fetchEdge(`/memories/${id}/category`, {
        method: "POST",
        body: JSON.stringify({ category }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["local-stats"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
    },
    onError: (err: Error) => alert(errorDetail(err)),
  });

  // Re-run Gate v2 on a note that fell back to private while the LLM was down
  const reclassifyMutation = useMutation({
    mutationFn: (id: string) =>
      fetchEdge(`/memories/${id}/reclassify`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
    onError: (err: Error) => alert(errorDetail(err)),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formText.trim()) return;

    createMutation.mutate({
      text: formText,
      title: formTitle,
      asset_tag: formAsset,
      category: formCategory === "auto" ? null : formCategory,
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Memory Inspector
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">
              Dual Shards
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Physical on-disk storage: <strong className="text-rose-400 font-mono font-medium">private/</strong> (local only) &amp; <strong className="text-sky-400 font-mono font-medium">shared/</strong> (mirrors fleet outbox).
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(!isAddOpen)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors self-start sm:self-auto cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Log Note</span>
        </button>
      </div>

      {/* Add Note Panel */}
      {isAddOpen && (
        <form
          onSubmit={handleCreate}
          className="panel p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>New Field Note (Triage via Memory Gate)</span>
            </div>
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-medium text-slate-400">
                Optional Title
              </label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. P-200 Cavitation Troubleshooting"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-400">
                Asset Tag
              </label>
              <input
                type="text"
                value={formAsset}
                onChange={(e) => setFormAsset(e.target.value)}
                placeholder="e.g. P-200, C-14"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 uppercase"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-400">
              Note Body
            </label>
            <textarea
              rows={3}
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              placeholder="Describe observation, diagnosis, fix, or procedure..."
              required
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Route Mode:</span>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 focus:outline-none focus:border-sky-500"
              >
                <option value="auto">Auto (AI Memory Gate)</option>
                <option value="shareable">Force Shareable (Sync)</option>
                <option value="private">Force Private (Local)</option>
                <option value="routine">Force Routine (TTL 14d)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs hover:bg-slate-800 text-slate-400 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {createMutation.isPending ? "Routing & Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filters bar */}
      <div className="panel p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="text"
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            placeholder="Filter by asset tag (e.g. P-200)..."
            className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none font-mono"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 focus:outline-none focus:border-sky-500"
          >
            <option value="">All Shards / Categories</option>
            <option value="shareable">Shareable (Shared Shard)</option>
            <option value="private">Private (Local Shard)</option>
            <option value="routine">Routine (Local Shard)</option>
          </select>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer border border-slate-800"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Memory Table */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-slate-900/50 font-mono text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="p-3">Memory Content</th>
                <th className="p-3 w-28">Asset</th>
                <th className="p-3 w-52">Gate Classification</th>
                <th className="p-3 w-20">Version</th>
                <th className="p-3 w-24">Sync State</th>
                <th className="p-3 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    Loading local memories...
                  </td>
                </tr>
              ) : !memories || memories.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No memories found. Click "Log Technician Note" to create one.
                  </td>
                </tr>
              ) : (
                memories.map((m: any) => {
                  const isShareable = m.category === "shareable";
                  return (
                    <tr
                      key={m.memory_id}
                      className="hover:bg-slate-800/40 transition-colors group"
                    >
                      <td className="p-3 max-w-md">
                        {m.title && (
                          <div className="font-semibold text-slate-100 mb-0.5 line-clamp-1">
                            {m.title}
                          </div>
                        )}
                        <p className="text-slate-400 line-clamp-2 leading-relaxed">
                          {m.text}
                        </p>
                        <span className="text-[10px] font-mono text-slate-500 block mt-1">
                          ID: {m.memory_id} · {m.author}
                        </span>
                      </td>

                      <td className="p-3">
                        {m.asset_tag ? (
                          <span className="px-2 py-0.5 rounded bg-slate-800 font-mono font-medium text-[11px] text-slate-300 border border-slate-700">
                            {m.asset_tag}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono">—</span>
                        )}
                      </td>

                      <td className="p-3">
                        <GateBadge
                          category={m.category}
                          source={m.gate_source}
                          reason={m.gate_reason}
                          piiHits={m.pii_hits}
                          signals={m.gate_signals}
                          flags={m.gate_flags}
                          contextUsed={m.gate_context}
                        />
                      </td>

                      <td className="p-3 font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                          v{m.version || 1}
                        </span>
                      </td>

                      <td className="p-3 font-mono">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-medium border ${
                            m.sync_state === "synced"
                              ? "bg-emerald-950/30 text-emerald-400 border-emerald-800/40"
                              : m.sync_state === "pending"
                              ? "bg-amber-950/30 text-amber-400 border-amber-800/40"
                              : "bg-slate-800/40 text-slate-400 border-slate-700/40"
                          }`}
                        >
                          {m.sync_state}
                        </span>
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Re-classify: only for notes the LLM could not decide */}
                          {m.gate_source === "fallback" && (
                            <button
                              onClick={() => reclassifyMutation.mutate(m.memory_id)}
                              className="p-1.5 rounded hover:bg-slate-800 text-amber-400 hover:text-amber-300 transition-colors"
                              title="Re-classify with the on-device LLM"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Retraction / Override button */}
                          <button
                            onClick={() =>
                              overrideMutation.mutate({
                                id: m.memory_id,
                                category: isShareable ? "private" : "shareable",
                              })
                            }
                            className={`p-1.5 rounded hover:bg-slate-800 transition-colors ${
                              isShareable
                                ? "text-amber-400 hover:text-amber-300"
                                : "text-sky-400 hover:text-sky-300"
                            }`}
                            title={
                              isShareable
                                ? "Retract from fleet (Move to Private Shard)"
                                : "Publish to fleet (Move to Shared Shard)"
                            }
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete button */}
                          <button
                            onClick={() => {
                              if (confirm("Delete this memory?")) {
                                deleteMutation.mutate(m.memory_id);
                              }
                            }}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete memory"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
