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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Memory Inspector
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Physical shards: Private (never leaves) & Shared (mirrors fleet).
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(!isAddOpen)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-sky-400 transition-colors shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Log Technician Note</span>
        </button>
      </div>

      {/* Add Note Panel / Modal */}
      {isAddOpen && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-sky-500/40 bg-card p-5 space-y-4 animate-in fade-in duration-200"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-400 border-b border-border pb-3">
            <Sparkles className="w-4 h-4" />
            <span>New Technician Memory (Evaluated by AI Gate)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Optional Title
              </label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. P-200 Cavitation Troubleshooting"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs focus:outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Asset Tag
              </label>
              <input
                type="text"
                value={formAsset}
                onChange={(e) => setFormAsset(e.target.value)}
                placeholder="e.g. P-200, C-14"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary uppercase"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Note Body (Mandatory)
            </label>
            <textarea
              rows={3}
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              placeholder="Describe observation, diagnosis, fix, or procedure..."
              required
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Route Mode:</span>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="px-2.5 py-1.5 rounded-md bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary"
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
                className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-sky-400 disabled:opacity-50"
              >
                {createMutation.isPending ? "Routing & Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filters bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            placeholder="Filter by asset tag (e.g. P-200)..."
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1 rounded bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary"
          >
            <option value="">All Shards / Categories</option>
            <option value="shareable">Shareable (Shared Shard)</option>
            <option value="private">Private (Local Shard)</option>
            <option value="routine">Routine (Local Shard)</option>
          </select>
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Memory Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 font-mono text-muted-foreground">
                <th className="p-3">Memory Content</th>
                <th className="p-3 w-28">Asset</th>
                <th className="p-3 w-48">Gate Classification</th>
                <th className="p-3 w-24">Version</th>
                <th className="p-3 w-24">Sync State</th>
                <th className="p-3 w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-sans">
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
                      className="hover:bg-muted/20 transition-colors group"
                    >
                      <td className="p-3 max-w-md">
                        {m.title && (
                          <div className="font-semibold text-foreground mb-0.5 line-clamp-1">
                            {m.title}
                          </div>
                        )}
                        <p className="text-muted-foreground line-clamp-2 leading-relaxed">
                          {m.text}
                        </p>
                        <span className="text-[10px] font-mono text-muted-foreground/60 block mt-1">
                          ID: {m.memory_id} · {m.author}
                        </span>
                      </td>

                      <td className="p-3">
                        {m.asset_tag ? (
                          <span className="px-2 py-0.5 rounded bg-muted font-mono font-semibold text-foreground border border-border">
                            {m.asset_tag}
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-mono">—</span>
                        )}
                      </td>

                      <td className="p-3">
                        <GateBadge
                          category={m.category}
                          source={m.gate_source}
                          reason={m.gate_reason}
                          piiHits={m.pii_hits}
                        />
                      </td>

                      <td className="p-3 font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          v{m.version || 1}
                        </span>
                      </td>

                      <td className="p-3 font-mono">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                            m.sync_state === "synced"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : m.sync_state === "pending"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                          }`}
                        >
                          {m.sync_state}
                        </span>
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Retraction / Override button */}
                          <button
                            onClick={() =>
                              overrideMutation.mutate({
                                id: m.memory_id,
                                category: isShareable ? "private" : "shareable",
                              })
                            }
                            className={`p-1.5 rounded hover:bg-muted transition-colors ${
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
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-rose-400 transition-colors"
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
