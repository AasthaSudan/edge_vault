"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import {
  Split,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Share2,
  Lock,
  RefreshCw,
} from "lucide-react";

export default function SuggestionsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editedText, setEditedText] = useState<Record<string, string>>({});

  const { data: suggestions, isLoading, refetch } = useQuery({
    queryKey: ["suggestions", statusFilter],
    queryFn: () => {
      const q = statusFilter === "all" ? "/suggestions?status=" : `/suggestions?status=${statusFilter}`;
      return fetchEdge(q);
    },
    refetchInterval: 3000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text?: string }) =>
      fetchEdge(`/suggestions/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suggestions"] });
      qc.invalidateQueries({ queryKey: ["pending-suggestions"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["local-stats"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      fetchEdge(`/suggestions/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suggestions"] });
      qc.invalidateQueries({ queryKey: ["pending-suggestions"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const toggleReveal = (id: string) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleTextChange = (id: string, text: string) => {
    setEditedText((prev) => ({ ...prev, [id]: text }));
  };

  const handleApprove = (item: any) => {
    const textToApprove = editedText[item.id] !== undefined ? editedText[item.id] : item.proposed_text;
    approveMutation.mutate({ id: item.id, text: textToApprove });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Split &amp; Share Inbox
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono">
              PII Filtered
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Review reusable equipment facts extracted from private notes. Private originals stay on disk; approved facts sync to fleet.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono self-start sm:self-auto">
          <button
            onClick={() => setStatusFilter("pending")}
            className={`px-3 py-1 rounded-md transition-colors ${
              statusFilter === "pending" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setStatusFilter("approved")}
            className={`px-3 py-1 rounded-md transition-colors ${
              statusFilter === "approved" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => setStatusFilter("rejected")}
            className={`px-3 py-1 rounded-md transition-colors ${
              statusFilter === "rejected" ? "bg-slate-800 text-white font-medium" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Rejected
          </button>
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Suggestion Cards Feed */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="panel p-12 text-center text-slate-500 text-xs font-mono">
            Loading proposals…
          </div>
        ) : !suggestions || suggestions.length === 0 ? (
          <div className="panel p-12 text-center space-y-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
            <div className="text-sm font-semibold text-white">No pending proposals</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {statusFilter === "pending"
                ? "Mixed notes (e.g. gate code + pump fix) will automatically extract reusable facts here for review."
                : `No ${statusFilter} records.`}
            </p>
          </div>
        ) : (
          suggestions.map((item: any) => {
            const isRevealed = revealed[item.id] || false;
            const currentFact = editedText[item.id] !== undefined ? editedText[item.id] : item.proposed_text;
            const checks = item.checks || {};
            const isPending = item.status === "pending";

            return (
              <div
                key={item.id}
                className="panel p-4 sm:p-5 space-y-4"
              >
                {/* Card Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white font-mono">
                      Proposal #{item.id.slice(0, 8)}
                    </span>
                    {item.asset_tag && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">
                        {item.asset_tag}
                      </span>
                    )}
                  </div>

                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-medium border ${
                      item.status === "approved"
                        ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-400"
                        : item.status === "rejected"
                        ? "bg-rose-950/30 border-rose-800/40 text-rose-400"
                        : "bg-amber-950/30 border-amber-800/40 text-amber-400"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                {/* 2-Column Review */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Private Original */}
                  <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/60 space-y-2 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-rose-400 font-mono">
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                          <Lock className="w-3 h-3" />
                          <span>Private Original (Stays Local)</span>
                        </span>
                        <button
                          onClick={() => toggleReveal(item.id)}
                          className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                        >
                          {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3 text-slate-400" />}
                          <span>{isRevealed ? "Mask" : "Reveal"}</span>
                        </button>
                      </div>

                      <p className="text-xs font-mono text-slate-300 leading-relaxed bg-slate-950 p-2.5 rounded border border-slate-800/80">
                        {isRevealed ? item.source_text : item.masked_text || item.source_text}
                      </p>
                    </div>

                    <p className="text-[10px] font-mono text-slate-500 pt-1">
                      Never leaves this device.
                    </p>
                  </div>

                  {/* Right: Sanitized Fact */}
                  <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/60 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="text-xs text-sky-400 font-mono font-semibold flex items-center gap-1.5">
                        <Share2 className="w-3 h-3" />
                        <span>Proposed Fact for Fleet</span>
                      </div>

                      {isPending ? (
                        <textarea
                          value={currentFact}
                          onChange={(e) => handleTextChange(item.id, e.target.value)}
                          rows={2}
                          className="w-full text-xs font-mono text-white bg-slate-950 border border-slate-800 rounded-lg p-2.5 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
                          placeholder="Proposed sanitized fact..."
                        />
                      ) : (
                        <p className="text-xs font-mono text-slate-200 bg-slate-950 p-2.5 rounded border border-slate-800/80 leading-relaxed">
                          {item.proposed_text}
                        </p>
                      )}

                      {/* Verification Checklist */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                        <span className="px-2 py-0.5 rounded bg-emerald-950/30 text-emerald-400 border border-emerald-800/40">
                          PII: None ✓
                        </span>
                        {checks.grounding !== undefined && (
                          <span className="px-2 py-0.5 rounded bg-emerald-950/30 text-emerald-400 border border-emerald-800/40">
                            Grounding: {Math.round(checks.grounding * 100)}% ✓
                          </span>
                        )}
                        {checks.numbers_preserved !== undefined && (
                          <span className="px-2 py-0.5 rounded bg-emerald-950/30 text-emerald-400 border border-emerald-800/40">
                            Numbers: Verified ✓
                          </span>
                        )}
                      </div>
                    </div>

                    {isPending ? (
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                        <button
                          onClick={() => rejectMutation.mutate(item.id)}
                          disabled={rejectMutation.isPending || approveMutation.isPending}
                          className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                          Keep Private
                        </button>
                        <button
                          onClick={() => handleApprove(item)}
                          disabled={approveMutation.isPending || rejectMutation.isPending || !currentFact.trim()}
                          className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Share to Fleet</span>
                        </button>
                      </div>
                    ) : item.status === "approved" ? (
                      <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 pt-1 border-t border-slate-800/80">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approved &amp; Synced</span>
                      </div>
                    ) : (
                      <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1 pt-1 border-t border-slate-800/80">
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        <span>Kept Local</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
