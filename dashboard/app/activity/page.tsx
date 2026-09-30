"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ChevronRight } from "lucide-react";
import { useEdgeEvents, EdgeEvent } from "@/lib/sse";
import { EDGE_API } from "@/lib/api";
import { category } from "@/lib/format";
import { EmptyState, PageHeader, Segmented, cn } from "@/components/ui";

type Group = "all" | "notes" | "privacy" | "sync" | "conflicts" | "assistant";

const GROUPS: Record<Exclude<Group, "all">, { prefixes: string[]; dot: string }> = {
  notes: { prefixes: ["memory.", "dedup.", "ttl."], dot: "bg-accent" },
  privacy: { prefixes: ["gate.", "privacy.", "share."], dot: "bg-private" },
  sync: { prefixes: ["sync."], dot: "bg-ok" },
  conflicts: { prefixes: ["conflict."], dot: "bg-warn" },
  assistant: { prefixes: ["assistant."], dot: "bg-faint" },
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
  const { events, connected } = useEdgeEvents(EDGE_API);
  const [group, setGroup] = useState<Group>("all");

  const shown = events.filter((ev) => group === "all" || groupOf(ev.type) === group);

  return (
    <div>
      <Link href="/sync" className="btn btn-ghost btn-sm -ml-3 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Sync
      </Link>
      <PageHeader
        title="Activity"
        description="A live log of what's happening on this device."
        actions={
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <span className={cn("w-2 h-2 rounded-full", connected ? "bg-ok animate-pulse" : "bg-faint")} />
            {connected ? "Live" : "Connecting…"}
          </span>
        }
      />

      <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0 mb-4">
        <Segmented<Group>
          value={group}
          onChange={setGroup}
          options={[
            { value: "all", label: "All" },
            { value: "notes", label: "Notes" },
            { value: "privacy", label: "Privacy" },
            { value: "sync", label: "Sync" },
            { value: "conflicts", label: "Conflicts" },
            { value: "assistant", label: "Assistant" },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Activity} title="Waiting for activity">
          Save a note, ask a question or sync, and it will show up here as it happens.
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-line">
          {shown.map((ev, i) => {
            const g = groupOf(ev.type);
            const hasData = ev.data && Object.keys(ev.data).length > 0;
            return (
              <li key={`${ev.ts}-${i}`} className="first:rounded-t-xl last:rounded-b-xl">
                <details className="group">
                  <summary className="flex items-center gap-3 px-5 py-3 cursor-pointer list-none hover:bg-subtle/60 [&::-webkit-details-marker]:hidden">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", g ? GROUPS[g].dot : "bg-faint")} />
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-sm">{LABEL[ev.type] ?? ev.type}</span>
                      {detail(ev) && <span className="text-sm text-muted"> · {detail(ev)}</span>}
                    </span>
                    <time className="text-xs text-muted tabular-nums shrink-0">
                      {new Date(ev.ts).toLocaleTimeString()}
                    </time>
                    <ChevronRight className="w-4 h-4 text-faint transition-transform group-open:rotate-90 shrink-0" />
                  </summary>
                  <div className="px-5 pb-4">
                    <pre className="text-xs font-mono text-muted bg-subtle rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify({ type: ev.type, memory_id: ev.memory_id, ...(hasData ? ev.data : {}) }, null, 2)}
                    </pre>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
