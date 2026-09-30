"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, CloudOff, BadgeCheck, Lock, Clock, Users } from "lucide-react";
import { fetchCloud, POLL_MS } from "@/lib/api";
import { plural } from "@/lib/format";
import { IconTile, Tone, cn } from "./ui";

// Live audit of the team server: private and temporary notes must never appear there.
export function PrivacyCheck({ detailed = false, compact = false }: { detailed?: boolean; compact?: boolean }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["cloud-stats"],
    queryFn: () => fetchCloud("/stats"),
    refetchInterval: POLL_MS,
  });

  const leaked = (data?.private_on_server ?? 0) + (data?.routine_on_server ?? 0);

  const view: { icon: typeof ShieldCheck; tone: Tone; title: string; short: string; body: string } = isError
    ? {
        icon: CloudOff,
        tone: "neutral",
        title: "Team server unreachable",
        short: "Server unreachable",
        body: "Your notes are safe on this device. The privacy check will run again when the server is back.",
      }
    : leaked > 0
    ? {
        icon: ShieldAlert,
        tone: "danger",
        title: "Privacy check failed",
        short: "Check failed",
        body: `${plural(leaked, "private note")} found on the team server. Review your shared notes.`,
      }
    : {
        icon: ShieldCheck,
        tone: "ok",
        title: isLoading ? "Checking privacy…" : "Privacy check passed",
        short: isLoading ? "Checking…" : "Privacy check passed",
        body: isLoading
          ? "Asking the team server what it holds."
          : `The team server holds ${plural(data?.shareable_on_server ?? 0, "shared note")} and none of your private ones.`,
      };

  if (compact) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 bg-surface ring-1 ring-line shadow-card" title={view.body}>
        <IconTile icon={view.icon} tone={view.tone} size="sm" />
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-medium truncate">{view.short}</div>
          <div className="text-[11px] text-muted truncate">
            {isError ? "Notes stay on this device" : leaked > 0 ? `${leaked} private on server` : "Nothing private has left"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 relative overflow-hidden">
      {view.tone === "ok" && !isLoading && (
        <ShieldCheck className="absolute -right-6 -bottom-8 w-40 h-40 text-ok/[0.06] pointer-events-none" />
      )}
      <div className="relative flex items-start gap-4">
        <IconTile icon={view.icon} tone={view.tone} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{view.title}</h3>
          <p className="text-sm text-muted mt-0.5">{view.body}</p>
        </div>
      </div>

      {detailed && data && !isError && (
        <dl className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <Stat icon={Users} tone="shared" label="Shared" value={data.shareable_on_server ?? 0} />
          <Stat icon={BadgeCheck} tone="ok" label="Confirmed by 2+ devices" value={data.fleet_verified_on_server ?? 0} />
          <Stat icon={Lock} tone="private" label="Private" value={data.private_on_server ?? 0} bad={data.private_on_server > 0} />
          <Stat icon={Clock} tone="temp" label="Temporary" value={data.routine_on_server ?? 0} bad={data.routine_on_server > 0} />
        </dl>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  bad,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  label: string;
  value: number;
  bad?: boolean;
}) {
  return (
    <div className={cn("rounded-xl px-3.5 py-3 ring-1 ring-inset", bad ? "bg-danger/5 ring-danger/20" : "bg-subtle/60 ring-line")}>
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        <IconTile icon={Icon} tone={bad ? "danger" : tone} size="xs" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className={cn("text-xl font-semibold tabular-nums mt-1.5", bad && "text-danger")}>{value}</dd>
    </div>
  );
}
