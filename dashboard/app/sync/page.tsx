"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  CloudUpload,
  ListOrdered,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { errorDetail, plural, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { PrivacyCheck } from "@/components/PrivacyCheck";
import { IconTile, PageHeader, Tone, cn } from "@/components/ui";

const QUEUE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "bg-warn/10 text-warn" },
  inflight: { label: "Sending", cls: "bg-accent/10 text-accent" },
  done: { label: "Sent", cls: "bg-ok/10 text-ok" },
};

export default function SyncPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showQueue, setShowQueue] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: POLL_MS,
  });
  const { data: queue } = useQuery({
    queryKey: ["outbox"],
    queryFn: () => fetchEdge("/sync/outbox"),
    refetchInterval: POLL_MS,
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

  const hero: { icon: typeof CloudOff; tone: Tone; title: string; body: string } = offline
    ? {
        icon: CloudOff,
        tone: "warn",
        title: "You're offline",
        body: waiting
          ? `${plural(waiting, "note")} will sync as soon as you're back online.`
          : "New shared notes will sync as soon as you're back online.",
      }
    : waiting > 0
    ? {
        icon: CloudUpload,
        tone: "shared",
        title: `${plural(waiting, "note")} waiting to sync`,
        body: "They'll be sent automatically in a moment, or you can sync now.",
      }
    : {
        icon: CheckCircle2,
        tone: "ok",
        title: "Everything is up to date",
        body: "Your shared notes match your team's.",
      };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sync"
        description="Keep your shared notes in step with your team."
        actions={
          // Desktop has Activity in the sidebar
          <Link href="/activity" className="btn btn-secondary lg:hidden">
            <Activity className="w-4 h-4" />
            Activity log
          </Link>
        }
      />

      <section className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-6">
          <span className="relative w-fit">
            {(waiting > 0 || syncNow.isPending) && !offline && (
              <span className="absolute inset-0 rounded-2xl bg-shared/20 animate-ping" />
            )}
            <IconTile icon={hero.icon} tone={hero.tone} size="lg" className="relative" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{hero.title}</h2>
            <p className="text-sm text-muted mt-1">{hero.body}</p>
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
        <div className="flex flex-wrap gap-x-8 gap-y-2 px-6 py-3.5 border-t border-line text-sm">
          <span className="inline-flex items-center gap-2">
            <ArrowUpFromLine className="w-4 h-4 text-faint" />
            <span className="text-muted">Last sent</span>
            {timeAgo(status?.last_push_at)}
          </span>
          <span className="inline-flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-faint" />
            <span className="text-muted">Last received</span>
            {timeAgo(status?.last_pull_at)}
          </span>
        </div>
      </section>

      <PrivacyCheck detailed />

      <section className="card">
        <button
          onClick={() => setShowQueue((v) => !v)}
          aria-expanded={showQueue}
          className="w-full flex items-center gap-3 px-5 py-4 text-left"
        >
          <IconTile icon={ListOrdered} tone="neutral" size="sm" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold">Sync queue</span>
            <span className="block text-xs text-muted">
              Recent changes sent to your team. The queue is saved on disk, so nothing is lost if the device restarts.
            </span>
          </span>
          <ChevronDown className={cn("w-4 h-4 text-muted transition-transform", !showQueue && "-rotate-90")} />
        </button>

        {showQueue && (
          <div className="border-t border-line animate-fade-in">
            {!Array.isArray(queue) || queue.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">No recent changes.</p>
            ) : (
              <ul className="divide-y divide-line">
                {queue.map((row: any) => {
                  // A failed send goes back to pending with its attempt count raised
                  const s =
                    row.status === "pending" && row.attempts > 0
                      ? { label: "Retrying", cls: "bg-danger/10 text-danger" }
                      : QUEUE_STATUS[row.status] ?? { label: row.status, cls: "bg-subtle text-muted" };
                  const removal = row.op === "delete";
                  return (
                    <li key={row.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                      <IconTile icon={removal ? Trash2 : Upload} tone={removal ? "danger" : "accent"} size="sm" />
                      <span className="w-20 shrink-0 font-medium">{removal ? "Removal" : "Update"}</span>
                      <span className="flex-1 min-w-0 truncate font-mono text-xs text-muted" title={row.memory_id}>
                        {row.memory_id.slice(0, 8)}
                        {row.last_error && <span className="text-danger font-sans ml-2">{row.last_error}</span>}
                      </span>
                      <span className="hidden sm:block text-xs text-muted w-24 text-right">{timeAgo(row.created_at)}</span>
                      <span className={cn("inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium", s.cls)}>{s.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
