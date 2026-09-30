"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Check, AlertTriangle, CheckCircle2, Lock, Users, ArrowDown } from "lucide-react";
import { fetchEdge } from "@/lib/api";
import { errorDetail, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { ReviewHeader } from "@/components/ReviewTabs";
import { EmptyState, Segmented, Skeleton, cn } from "@/components/ui";

type View = "pending" | "history";

export default function SuggestionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>("pending");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["suggestions", view],
    // An empty status returns every suggestion; history is everything already decided
    queryFn: () => fetchEdge(view === "pending" ? "/suggestions?status=pending" : "/suggestions?status="),
    refetchInterval: 3000,
  });
  const items: any[] = (Array.isArray(data) ? data : []).filter((s) =>
    view === "pending" ? s.status === "pending" : s.status !== "pending"
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["suggestions"] });
    qc.invalidateQueries({ queryKey: ["pending-suggestions"] });
    qc.invalidateQueries({ queryKey: ["memories"] });
    qc.invalidateQueries({ queryKey: ["local-stats"] });
    qc.invalidateQueries({ queryKey: ["sync-status"] });
  };

  const approve = useMutation({
    mutationFn: ({ id, text }: { id: string; text?: string }) =>
      fetchEdge(`/suggestions/${id}/approve`, { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: () => {
      refresh();
      toast("Shared with your team. Your original note stays private.");
    },
    // The edge re-checks edited text for private info, grounding and numbers
    onError: (err) => toast(`Not shared: ${errorDetail(err)}`, "error"),
  });

  const reject = useMutation({
    mutationFn: (id: string) => fetchEdge(`/suggestions/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast("Kept private");
    },
    onError: (err) => toast(errorDetail(err), "error"),
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <div>
      <ReviewHeader
        actions={
          <Segmented<View>
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "pending", label: "To do" },
              { value: "history", label: "History" },
            ]}
          />
        }
      />

      {view === "pending" && (
        <p className="text-sm text-muted mb-6 max-w-2xl">
          When a private note also holds something useful to others, EdgeVault suggests a clean version to share. The
          original never leaves this device.
        </p>
      )}

      {isLoading ? (
        <Skeleton rows={2} />
      ) : items.length === 0 ? (
        view === "pending" ? (
          <EmptyState icon={CheckCircle2} title="Nothing to review">
            New suggestions appear here when a private note contains a reusable fix.
          </EmptyState>
        ) : (
          <EmptyState icon={CheckCircle2} title="No history yet">
            Suggestions you share or keep private will show up here.
          </EmptyState>
        )
      ) : view === "history" ? (
        <ul className="card divide-y divide-line">
          {items.map((s) => (
            <li key={s.id} className="flex items-start gap-4 px-5 py-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm">{s.proposed_text}</p>
                <p className="text-xs text-muted mt-1">
                  {s.asset_tag && <span className="tag mr-2">{s.asset_tag}</span>}
                  {timeAgo(s.decided_at || s.created_at)}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium shrink-0",
                  s.status === "approved" ? "text-accent" : "text-muted"
                )}
              >
                {s.status === "approved" ? <Users className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                {s.status === "approved" ? "Shared" : "Kept private"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          {items.map((s) => {
            const text = edited[s.id] ?? s.proposed_text;
            const checks = s.checks || {};
            const isRevealed = !!revealed[s.id];
            const results = [
              { ok: !(checks.pii?.length > 0), label: "No private info" },
              // Same bar as GROUNDING_MIN in edge/gate/sanitize.py
              checks.grounding !== undefined && { ok: checks.grounding >= 0.75, label: "Matches your note" },
              checks.numbers_preserved !== undefined && {
                ok: !!checks.numbers_preserved,
                label: checks.numbers_preserved ? "Numbers unchanged" : "Numbers differ",
              },
            ].filter(Boolean) as { ok: boolean; label: string }[];

            return (
              <article key={s.id} className="card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-xs text-muted min-w-0">
                    <Lock className="w-3.5 h-3.5 text-private shrink-0" />
                    <span className="truncate">
                      From your private note{s.source_title ? ` “${s.source_title}”` : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => setRevealed((r) => ({ ...r, [s.id]: !isRevealed }))}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg shrink-0"
                  >
                    {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {isRevealed ? "Hide" : "Show"} codes
                  </button>
                </div>
                <p className="text-sm text-muted leading-relaxed bg-subtle rounded-lg px-4 py-3">
                  {isRevealed ? s.source_text : s.masked_text || s.source_text}
                </p>

                <div className="flex justify-center my-2 text-faint">
                  <ArrowDown className="w-4 h-4" />
                </div>

                <label htmlFor={`fact-${s.id}`} className="flex items-center gap-2 text-xs text-muted mb-2">
                  <Users className="w-3.5 h-3.5 text-accent" />
                  Suggested for your team
                  {s.asset_tag && <span className="tag">{s.asset_tag}</span>}
                </label>
                <textarea
                  id={`fact-${s.id}`}
                  value={text}
                  onChange={(e) => setEdited((d) => ({ ...d, [s.id]: e.target.value }))}
                  rows={2}
                  className="input text-[15px]"
                />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4">
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {results.map((r) => (
                      <li
                        key={r.label}
                        className={cn("inline-flex items-center gap-1 text-xs", r.ok ? "text-muted" : "text-warn")}
                      >
                        {r.ok ? <Check className="w-3.5 h-3.5 text-ok" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                        {r.label}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => reject.mutate(s.id)} disabled={busy} className="btn btn-ghost">
                      Keep private
                    </button>
                    <button
                      onClick={() => approve.mutate({ id: s.id, text })}
                      disabled={busy || !text.trim()}
                      className="btn btn-primary"
                    >
                      Share with team
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
