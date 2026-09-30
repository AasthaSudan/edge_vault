"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ChevronRight, FileText, GitMerge, RefreshCw, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useEdgeEvents, EdgeEvent } from "@/lib/sse";
import { category } from "@/lib/format";
import { EmptyState, IconTile, PageHeader, StatusDot, Tone, cn } from "@/components/ui";

type Group = "all" | "notes" | "privacy" | "sync" | "conflicts" | "assistant";

const GROUPS: Record<
  Exclude<Group, "all">,
  { label: string; prefixes: string[]; icon: React.ComponentType<{ className?: string }>; tone: Tone }
> = {
  notes: { label: "Notes", prefixes: ["memory.", "dedup.", "ttl."], icon: FileText, tone: "accent" },
  privacy: { label: "Privacy", prefixes: ["gate.", "privacy.", "share."], icon: ShieldCheck, tone: "private" },
  sync: { label: "Sync", prefixes: ["sync."], icon: RefreshCw, tone: "shared" },
  conflicts: { label: "Conflicts", prefixes: ["conflict."], icon: GitMerge, tone: "warn" },
  assistant: { label: "Assistant", prefixes: ["assistant."], icon: Sparkles, tone: "neutral" },
};

const LABEL: Record<string, string> = {
  "memory.created": "Note saved",
  "memory.updated": "Note updated",
  "memory.deleted": "Note deleted",
  "dedup.merged": "Merged with a similar note",
  "ttl.expired": "Temporary note expired",
  "gate.decided": "Visibility decided",
  "gate.overridden": "Visibility changed",
  "gate.error": "Privacy check failed",
  "privacy.blocked": "Private info blocked from leaving",
  "share.suggested": "New share suggestion",
  "share.approved": "Suggestion shared",
  "share.rejected": "Suggestion kept private",
  "share.rejected_auto": "Suggestion discarded automatically",
  "sync.offline": "Went offline",
  "sync.online": "Back online",
  "sync.push.ok": "Sent changes to your team",
  "sync.push.failed": "Couldn't send changes",
  "sync.pull.ok": "Received team updates",
  "sync.pull.skipped": "Skipped fetching updates",
  "conflict.opened": "Conflict found",
  "conflict.analyzed": "Conflict compared by AI",
  "conflict.resolved": "Conflict resolved",
  "assistant.answered": "Question answered",
  "stream.connected": "Live log connected",
};

function groupOf(type: string) {
  return (Object.keys(GROUPS) as (keyof typeof GROUPS)[]).find((g) =>
    GROUPS[g].prefixes.some((p) => type.startsWith(p))
  );
}

function detail(ev: EdgeEvent) {
  const d = ev.data || {};
  if (d.category && (ev.type.startsWith("gate.") || ev.type.startsWith("memory."))) {
    return `${category(d.category).label}${d.reason ? ` · ${d.reason}` : ""}`;
  }
  return d.reason || d.detail || d.error || "";
}

export default function ActivityPage() {
  const { events, connected } = useEdgeEvents();
  const [group, setGroup] = useState<Group>("all");

  const shown = events.filter((ev) => group === "all" || groupOf(ev.type) === group);
  const count = (g: Exclude<Group, "all">) => events.filter((ev) => groupOf(ev.type) === g).length;

  return (
    <div>
      <Link href="/sync" className="lg:hidden btn btn-ghost btn-sm -ml-3 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Sync
      </Link>
      <PageHeader
        title="Activity"
        description="A live log of what's happening on this device."
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-2 h-8 px-3 rounded-full text-sm font-medium ring-1 ring-inset",
              connected ? "bg-ok/10 text-ok ring-ok/20" : "bg-subtle text-muted ring-line"
            )}
          >
            <StatusDot className={connected ? "bg-ok" : "bg-faint"} pulse={connected} />
            {connected ? "Live" : "Connecting…"}
          </span>
        }
      />

      {/* Filters double as a per-group tally */}
      <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
        <div className="flex gap-2 w-max sm:w-auto sm:flex-wrap">
          <Chip active={group === "all"} onClick={() => setGroup("all")} icon={Zap} label="All" count={events.length} />
          {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => (
            <Chip
              key={g}
              active={group === g}
              onClick={() => setGroup(g)}
              icon={GROUPS[g].icon}
              label={GROUPS[g].label}
              count={count(g)}
            />
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Activity} title="Waiting for activity">
          Save a note, ask a question or sync, and it will show up here as it happens.
        </EmptyState>
      ) : (
        <div className="card p-2 sm:p-3">
          <ol className="relative">
            <span className="absolute left-[27px] sm:left-[31px] top-5 bottom-5 w-px bg-line" aria-hidden />
            {shown.map((ev, i) => {
              const g = groupOf(ev.type);
              const meta = g ? GROUPS[g] : { icon: Zap, tone: "neutral" as Tone };
              const hasData = ev.data && Object.keys(ev.data).length > 0;
              const failed = /failed|error|blocked/.test(ev.type);
              return (
                <li key={`${ev.ts}-${i}`} className="relative">
                  <details className="group">
                    <summary className="flex items-center gap-3 px-3 sm:px-4 py-2.5 rounded-xl cursor-pointer list-none hover:bg-subtle/60 [&::-webkit-details-marker]:hidden">
                      {/* Opaque backing so the timeline rail doesn't show through the tinted tile */}
                      <span className="relative rounded-lg bg-surface">
                        <IconTile icon={meta.icon} tone={failed ? "danger" : meta.tone} size="sm" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{LABEL[ev.type] ?? ev.type}</span>
                        {detail(ev) && <span className="block text-xs text-muted truncate">{detail(ev)}</span>}
                      </span>
                      <time className="text-xs text-muted tabular-nums shrink-0">{new Date(ev.ts).toLocaleTimeString()}</time>
                      <ChevronRight className="w-4 h-4 text-faint transition-transform group-open:rotate-90 shrink-0" />
                    </summary>
                    <div className="pl-14 sm:pl-[3.75rem] pr-3 pb-3">
                      <pre className="text-xs font-mono text-muted bg-subtle rounded-xl p-3 overflow-x-auto ring-1 ring-line">
                        {JSON.stringify({ type: ev.type, memory_id: ev.memory_id, ...(hasData ? ev.data : {}) }, null, 2)}
                      </pre>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-full text-sm font-medium ring-1 ring-inset transition-all whitespace-nowrap",
        active ? "bg-accent text-on-accent ring-accent shadow-glow" : "bg-surface text-muted ring-line hover:text-fg hover:ring-line-strong"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
      <span
        className={cn(
          "min-w-[22px] h-5 px-1.5 rounded-full text-[11px] tabular-nums flex items-center justify-center",
          active ? "bg-on-accent/20" : "bg-subtle"
        )}
      >
        {count}
      </span>
    </button>
  );
}
