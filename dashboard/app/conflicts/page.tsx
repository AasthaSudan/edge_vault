"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, GitMerge, Loader2, Sparkles, Smartphone, Users } from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { errorDetail, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { ReviewHeader } from "@/components/ReviewTabs";
import { Avatar, EmptyState, IconTile, Skeleton, cn } from "@/components/ui";

type Resolution = "keep_local" | "keep_remote" | "merged";

type Analysis = {
  relation: "progression" | "contradiction" | "same_fact" | "unknown";
  explanation: string;
  recommendation: "keep_local" | "keep_remote" | "merge";
  merged_text: string;
  source: string;
  value_differences?: string[];
};

const RELATION: Record<string, string> = {
  progression: "Updated over time",
  contradiction: "The versions disagree",
  same_fact: "Same fact, different words",
};

const SUGGESTS: Record<string, string> = {
  keep_local: "Suggests keeping your version.",
  keep_remote: "Suggests keeping the team version.",
  merge: "Suggests combining them.",
};

const RESOLVED: Record<string, string> = {
  keep_local: "Kept your version",
  keep_remote: "Kept team version",
  merged: "Combined",
};

export default function ConflictsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => fetchEdge("/conflicts"),
    refetchInterval: POLL_MS,
  });
  const [showResolved, setShowResolved] = useState(false);

  const all: any[] = Array.isArray(data) ? data : [];
  const open = all.filter((c) => c.status === "open");
  const resolved = all.filter((c) => c.status !== "open");

  return (
    <div>
      <ReviewHeader />

      {isLoading ? (
        <Skeleton rows={2} />
      ) : open.length === 0 ? (
        <EmptyState icon={CheckCircle2} tone="ok" title="No conflicts">
          All your devices agree. Nothing needs a decision.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {open.map((c) => (
            <ConflictCard key={c.id} c={c} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform", !showResolved && "-rotate-90")} />
            Resolved
            <span className="tag">{resolved.length}</span>
          </button>
          {showResolved && (
            <ul className="card divide-y divide-line mt-3 animate-fade-in">
              {resolved.map((c) => (
                <li key={c.id} className="flex items-start gap-4 px-5 py-3.5">
                  <IconTile icon={CheckCircle2} tone="ok" size="sm" />
                  <p className="flex-1 min-w-0 text-sm text-muted line-clamp-2 pt-1.5">
                    {c.resolution === "keep_remote" ? c.remote?.text : c.local?.text}
                  </p>
                  <span className="text-xs text-muted shrink-0 pt-2">
                    {RESOLVED[c.resolution] ?? "Resolved"} · {timeAgo(c.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ConflictCard({ c }: { c: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [merging, setMerging] = useState(false);
  const [mergedText, setMergedText] = useState("");
  const local = c.local || {};
  const remote = c.remote || {};

  // On-device reconciliation, cached by the edge after the first run
  const { data: a, isFetching } = useQuery<Analysis>({
    queryKey: ["conflict-analysis", c.id],
    queryFn: () => fetchEdge(`/conflicts/${c.id}/analyze`, { method: "POST" }),
    initialData: c.analysis ?? undefined,
    enabled: !c.analysis,
    staleTime: Infinity,
    retry: false,
  });

  const resolve = useMutation({
    mutationFn: ({ resolution, text }: { resolution: Resolution; text?: string }) =>
      fetchEdge(`/conflicts/${c.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution, merged_text: text || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conflicts"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      toast("Conflict resolved");
    },
    onError: (err) => toast(errorDetail(err), "error"),
  });

  const understood = a && a.relation !== "unknown" && a.source !== "fallback";
  const rec = understood ? a.recommendation : undefined;
  const btn = (r: string) => (rec === r ? "btn btn-primary" : "btn btn-secondary");

  return (
    <article className="card overflow-hidden animate-fade-in">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-line bg-subtle/40">
        <IconTile icon={GitMerge} tone="warn" size="sm" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{local.title || remote.title || "A note was changed on two devices"}</h3>
          <div className="text-xs text-muted">Found {timeAgo(c.created_at)}</div>
        </div>
        {(local.asset_tag || remote.asset_tag) && <span className="tag shrink-0">{local.asset_tag || remote.asset_tag}</span>}
      </header>

      <div className="grid md:grid-cols-2 md:divide-x divide-line">
        <Version
          label="Your version"
          icon={Smartphone}
          who={local.author || "You"}
          text={local.text}
          recommended={rec === "keep_local"}
        />
        <Version
          label="Team version"
          icon={Users}
          who={remote.author || remote.device_id || "Another device"}
          text={remote.text}
          recommended={rec === "keep_remote"}
          className="border-t md:border-t-0 border-line"
        />
      </div>

      <div className="px-5 pb-5">
        {isFetching && !a ? (
          <p className="flex items-center gap-2 text-sm text-muted rounded-xl bg-subtle/60 px-4 py-3">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            Comparing the two versions on this device…
          </p>
        ) : understood ? (
          <div className="rounded-xl bg-gradient-to-br from-accent/[0.08] to-accent-2/[0.06] ring-1 ring-inset ring-accent/20 px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Sparkles className="w-3.5 h-3.5" />
              AI suggestion{RELATION[a.relation] ? ` · ${RELATION[a.relation]}` : ""}
            </div>
            <p className="text-sm mt-1.5 leading-relaxed">
              {a.explanation} <span className="text-muted">{SUGGESTS[a.recommendation]}</span>
            </p>
            {a.value_differences && a.value_differences.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {a.value_differences.map((d) => (
                  <span key={d} className="tag bg-surface">
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : a ? (
          <p className="text-sm text-muted rounded-xl bg-subtle/60 px-4 py-3">
            The AI couldn&apos;t compare these. Read both and pick one.
          </p>
        ) : null}
      </div>

      {merging ? (
        <div className="px-5 pb-5 space-y-3 animate-fade-in">
          <label htmlFor={`merge-${c.id}`} className="label">
            Combined note
          </label>
          <textarea
            id={`merge-${c.id}`}
            rows={4}
            autoFocus
            value={mergedText}
            onChange={(e) => setMergedText(e.target.value)}
            className="input rounded-xl"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setMerging(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={() => resolve.mutate({ resolution: "merged", text: mergedText })}
              disabled={!mergedText.trim() || resolve.isPending}
              className="btn btn-primary"
            >
              Save combined note
            </button>
          </div>
        </div>
      ) : (
        <footer className="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-line bg-subtle/40">
          <button
            onClick={() => resolve.mutate({ resolution: "keep_local" })}
            disabled={resolve.isPending}
            className={btn("keep_local")}
          >
            Keep mine
          </button>
          <button
            onClick={() => resolve.mutate({ resolution: "keep_remote" })}
            disabled={resolve.isPending}
            className={btn("keep_remote")}
          >
            Keep theirs
          </button>
          <button
            onClick={() => {
              // Start from the AI's grounded merge when it proposed one
              setMergedText(a?.merged_text || `${local.text}\n\n${remote.text}`);
              setMerging(true);
            }}
            disabled={resolve.isPending}
            className={btn("merge")}
          >
            <GitMerge className="w-4 h-4" />
            Combine…
          </button>
        </footer>
      )}
    </article>
  );
}

function Version({
  label,
  icon: Icon,
  who,
  text,
  recommended,
  className,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  who: string;
  text?: string;
  recommended?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("p-5", className)}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-2 text-xs font-semibold">
          <Icon className="w-3.5 h-3.5 text-muted" />
          {label}
          {recommended && (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-accent/10 text-accent text-[11px] font-medium">
              <Sparkles className="w-3 h-3" />
              Suggested
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted min-w-0">
          <Avatar name={who} size="sm" />
          <span className="truncate">{who}</span>
        </span>
      </div>
      <p
        className={cn(
          "text-sm leading-relaxed text-fg/90 whitespace-pre-wrap rounded-xl px-4 py-3 ring-1 ring-inset",
          recommended ? "bg-accent/5 ring-accent/25" : "bg-subtle/60 ring-line"
        )}
      >
        {text}
      </p>
    </div>
  );
}
