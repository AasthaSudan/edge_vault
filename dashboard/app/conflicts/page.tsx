"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { fetchEdge } from "@/lib/api";
import { errorDetail, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { ReviewHeader } from "@/components/ReviewTabs";
import { EmptyState, Skeleton, cn } from "@/components/ui";

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
    refetchInterval: 3000,
  });
  const [showResolved, setShowResolved] = useState(false);

  const all: any[] = Array.isArray(data) ? data : [];
  const open = all.filter((c) => c.status === "open");
  const resolved = all.filter((c) => c.status !== "open");

  return (
    <div>
      <ReviewHeader />

      <p className="text-sm text-muted mb-6 max-w-2xl">
        When two devices change the same note while offline, choose which version to keep.
      </p>

      {isLoading ? (
        <Skeleton rows={2} />
      ) : open.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No conflicts">
          All your devices agree. Nothing needs a decision.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {open.map((c) => (
            <ConflictCard key={c.id} c={c} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform", !showResolved && "-rotate-90")} />
            Resolved ({resolved.length})
          </button>
          {showResolved && (
            <ul className="card divide-y divide-line mt-3 animate-fade-in">
              {resolved.map((c) => (
                <li key={c.id} className="flex items-start gap-4 px-5 py-3.5">
                  <p className="flex-1 min-w-0 text-sm text-muted line-clamp-2">
                    {c.resolution === "keep_remote" ? c.remote?.text : c.local?.text}
                  </p>
                  <span className="text-xs text-muted shrink-0">
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
    <article className="card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold truncate">
          {local.title || remote.title || "A note was changed on two devices"}
        </h3>
        <span className="text-xs text-muted shrink-0">{timeAgo(c.created_at)}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Version label="Your version" who={local.author || "You"} text={local.text} />
        <Version label="Team version" who={remote.author || remote.device_id || "Another device"} text={remote.text} />
      </div>

      <div className="mt-4">
        {isFetching && !a ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Comparing the two versions on this device…
          </p>
        ) : understood ? (
          <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
              <Sparkles className="w-3.5 h-3.5" />
              AI suggestion{RELATION[a.relation] ? ` · ${RELATION[a.relation]}` : ""}
            </div>
            <p className="text-sm mt-1.5 leading-relaxed">
              {a.explanation} <span className="text-muted">{SUGGESTS[a.recommendation]}</span>
            </p>
            {a.value_differences && a.value_differences.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {a.value_differences.map((d) => (
                  <span key={d} className="tag">
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : a ? (
          <p className="text-sm text-muted">The AI couldn&apos;t compare these. Read both and pick one.</p>
        ) : null}
      </div>

      {merging ? (
        <div className="mt-4 space-y-3 animate-fade-in">
          <label htmlFor={`merge-${c.id}`} className="label">
            Combined note
          </label>
          <textarea
            id={`merge-${c.id}`}
            rows={4}
            autoFocus
            value={mergedText}
            onChange={(e) => setMergedText(e.target.value)}
            className="input"
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
        <div className="flex flex-wrap justify-end gap-2 mt-5">
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
            Combine…
          </button>
        </div>
      )}
    </article>
  );
}

function Version({ label, who, text }: { label: string; who: string; text?: string }) {
  return (
    <div className="rounded-lg bg-subtle px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted truncate">{who}</span>
      </div>
      <p className="text-sm leading-relaxed text-fg/90 whitespace-pre-wrap">{text}</p>
    </div>
  );
}
