"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Users,
  ArrowRight,
  ArrowDown,
  Sparkles,
  History,
} from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { errorDetail, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { ReviewHeader } from "@/components/ReviewTabs";
import { EmptyState, IconTile, Segmented, Skeleton, cn } from "@/components/ui";

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
    refetchInterval: POLL_MS,
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

      {isLoading ? (
        <Skeleton rows={2} />
      ) : items.length === 0 ? (
        view === "pending" ? (
          <EmptyState icon={CheckCircle2} tone="ok" title="Nothing to review">
            New suggestions appear here when a private note contains a reusable fix.
          </EmptyState>
        ) : (
          <EmptyState icon={History} title="No history yet">
            Suggestions you share or keep private will show up here.
          </EmptyState>
        )
      ) : view === "history" ? (
        <ul className="card divide-y divide-line">
          {items.map((s) => {
            const shared = s.status === "approved";
            return (
              <li key={s.id} className="flex items-start gap-4 px-5 py-4">
                <IconTile icon={shared ? Users : Lock} tone={shared ? "shared" : "private"} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{s.proposed_text}</p>
                  <p className="flex items-center gap-2 text-xs text-muted mt-1.5">
                    {s.asset_tag && <span className="tag">{s.asset_tag}</span>}
                    {timeAgo(s.decided_at || s.created_at)}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-xs font-medium shrink-0",
                    shared ? "bg-shared/10 text-fg/80" : "bg-private/10 text-fg/80"
                  )}
                >
                  {shared ? "Shared" : "Kept private"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-5">
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
              <article key={s.id} className="card overflow-hidden animate-fade-in">
                <header className="flex items-center gap-3 px-5 py-3.5 border-b border-line bg-subtle/40">
                  <IconTile icon={Sparkles} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {s.source_title ? `From “${s.source_title}”` : "From one of your private notes"}
                    </div>
                    <div className="text-xs text-muted">Suggested {timeAgo(s.created_at)}</div>
                  </div>
                  <button
                    onClick={() => setRevealed((r) => ({ ...r, [s.id]: !isRevealed }))}
                    className="btn btn-ghost btn-sm shrink-0"
                  >
                    {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {isRevealed ? "Hide" : "Show"} codes
                  </button>
                </header>

                <div className="relative grid lg:grid-cols-2">
                  <div className="p-5 lg:border-r border-line">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted mb-2.5">
                      <Lock className="w-3.5 h-3.5 text-private" />
                      Your private note
                      <span className="font-normal text-faint">· stays on this device</span>
                    </div>
                    <p className="text-sm text-muted leading-relaxed rounded-xl bg-private/5 ring-1 ring-inset ring-private/15 px-4 py-3">
                      {isRevealed ? s.source_text : s.masked_text || s.source_text}
                    </p>
                  </div>

                  <span className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-surface ring-1 ring-line shadow-card items-center justify-center z-10">
                    <ArrowRight className="w-4 h-4 text-accent" />
                  </span>
                  <span className="lg:hidden flex justify-center -my-2 text-faint">
                    <ArrowDown className="w-4 h-4" />
                  </span>

                  <div className="p-5">
                    <label htmlFor={`fact-${s.id}`} className="flex items-center gap-2 text-xs font-medium text-muted mb-2.5">
                      <Users className="w-3.5 h-3.5 text-shared" />
                      Suggested for your team
                      {s.asset_tag && <span className="tag">{s.asset_tag}</span>}
                    </label>
                    <textarea
                      id={`fact-${s.id}`}
                      value={text}
                      onChange={(e) => setEdited((d) => ({ ...d, [s.id]: e.target.value }))}
                      rows={3}
                      className="input text-[15px] rounded-xl"
                    />
                  </div>
                </div>

                <footer className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 border-t border-line bg-subtle/40">
                  <ul className="flex flex-wrap gap-2">
                    {results.map((r) => (
                      <li
                        key={r.label}
                        className={cn(
                          "inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium",
                          r.ok ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
                        )}
                      >
                        {r.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                        {r.label}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => reject.mutate(s.id)} disabled={busy} className="btn btn-secondary">
                      <Lock className="w-4 h-4" />
                      Keep private
                    </button>
                    <button
                      onClick={() => approve.mutate({ id: s.id, text })}
                      disabled={busy || !text.trim()}
                      className="btn btn-primary"
                    >
                      <Users className="w-4 h-4" />
                      Share with team
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
