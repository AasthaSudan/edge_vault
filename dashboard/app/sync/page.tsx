"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudOff, CloudUpload, CheckCircle2, RefreshCw, ChevronDown, ArrowRight } from "lucide-react";
import { fetchEdge } from "@/lib/api";
import { errorDetail, plural, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { PrivacyCheck } from "@/components/PrivacyCheck";
import { PageHeader, cn } from "@/components/ui";

const QUEUE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "text-warn" },
  inflight: { label: "Sending", cls: "text-accent" },
  done: { label: "Sent", cls: "text-muted" },
};

export default function SyncPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showQueue, setShowQueue] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: 2500,
  });
  const { data: queue } = useQuery({
    queryKey: ["outbox"],
    queryFn: () => fetchEdge("/sync/outbox"),
    refetchInterval: 2500,
    enabled: showQueue,
  });

  const syncNow = useMutation({
    mutationFn: () => fetchEdge("/sync/now", { method: "POST" }),
    onSuccess: (data: any) => {
      ["sync-status", "outbox", "cloud-stats", "memories"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (data?.status === "skipped") return toast("Couldn't sync. This device is offline.", "info");
      // pushed is a count; pulled is whether fetching the team's changes succeeded
      const sent = data?.pushed > 0 ? `Sent ${plural(data.pushed, "note")} to your team.` : "";
      if (data?.pulled === false) toast(`${sent} Couldn't get your team's latest changes.`.trim(), "error");
      else toast(sent ? `Synced. ${sent}` : "Up to date with your team");
    },
    onError: (err) => toast(`Sync failed: ${errorDetail(err)}`, "error"),
  });

  const goOnline = useMutation({
    mutationFn: () => fetchEdge("/sync/offline?on=false", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-status"] }),
  });

  const offline = !!status?.forced_offline;
  const waiting = status?.outbox_depth ?? 0;

  const hero = offline
    ? {
        icon: CloudOff,
        tone: "bg-warn/10 text-warn",
        title: "You're offline",
        body: waiting
          ? `${plural(waiting, "note")} will sync as soon as you're back online.`
          : "New shared notes will sync as soon as you're back online.",
      }
    : waiting > 0
    ? {
        icon: CloudUpload,
        tone: "bg-accent/10 text-accent",
        title: `${plural(waiting, "note")} waiting to sync`,
        body: "They'll be sent automatically in a moment, or you can sync now.",
      }
    : {
        icon: CheckCircle2,
        tone: "bg-ok/10 text-ok",
        title: "Everything is up to date",
        body: "Your shared notes match your team's.",
      };
  const Icon = hero.icon;

  return (
    <div className="space-y-6">
      <PageHeader title="Sync" description="Keep your shared notes in step with your team." />

      <div className="card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className={cn("w-11 h-11 rounded-full flex items-center justify-center shrink-0", hero.tone)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{hero.title}</h2>
            <p className="text-sm text-muted mt-0.5">{hero.body}</p>
          </div>
          {offline ? (
            <button onClick={() => goOnline.mutate()} disabled={goOnline.isPending} className="btn btn-primary">
              Go online
            </button>
          ) : (
            <button
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
              className={waiting > 0 ? "btn btn-primary" : "btn btn-secondary"}
            >
              <RefreshCw className={cn("w-4 h-4", syncNow.isPending && "animate-spin")} />
              {syncNow.isPending ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 mt-6 pt-5 border-t border-line text-sm">
          <div>
            <span className="text-muted">Last sent </span>
            {timeAgo(status?.last_push_at)}
          </div>
          <div>
            <span className="text-muted">Last received </span>
            {timeAgo(status?.last_pull_at)}
          </div>
        </div>
      </div>

      <PrivacyCheck detailed />

      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowQueue((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ChevronDown className={cn("w-4 h-4 transition-transform", !showQueue && "-rotate-90")} />
          {showQueue ? "Hide details" : "Show details"}
        </button>
        <Link href="/activity" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          Activity log
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {showQueue && (
        <div className="card overflow-hidden animate-fade-in">
          <div className="px-5 py-3 border-b border-line text-xs text-muted">
            Recent changes sent to your team. The queue is saved on disk, so nothing is lost if the device restarts.
          </div>
          {!Array.isArray(queue) || queue.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No recent changes.</p>
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((row: any) => {
                // A failed send goes back to pending with its attempt count raised
                const s =
                  row.status === "pending" && row.attempts > 0
                    ? { label: "Retrying", cls: "text-danger" }
                    : QUEUE_STATUS[row.status] ?? { label: row.status, cls: "text-muted" };
                return (
                  <li key={row.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                    <span className="w-20 shrink-0">{row.op === "delete" ? "Removal" : "Update"}</span>
                    <span className="flex-1 min-w-0 truncate font-mono text-xs text-muted" title={row.memory_id}>
                      {row.memory_id.slice(0, 8)}
                      {row.last_error && <span className="text-danger font-sans ml-2">{row.last_error}</span>}
                    </span>
                    <span className="hidden sm:block text-xs text-muted w-24 text-right">{timeAgo(row.created_at)}</span>
                    <span className={cn("text-xs font-medium w-16 text-right", s.cls)}>{s.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
