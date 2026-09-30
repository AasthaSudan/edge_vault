"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, CloudOff } from "lucide-react";
import { fetchCloud } from "@/lib/api";
import { plural } from "@/lib/format";
import { cn } from "./ui";

// Live audit of the team server: private and temporary notes must never appear there.
export function PrivacyCheck({ detailed = false }: { detailed?: boolean }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["cloud-stats"],
    queryFn: () => fetchCloud("/stats"),
    refetchInterval: 5000,
  });

  const leaked = (data?.private_on_server ?? 0) + (data?.routine_on_server ?? 0);

  const view = isError
    ? {
        icon: CloudOff,
        tone: "text-muted bg-subtle",
        title: "Team server unreachable",
        body: "Your notes are safe on this device. The privacy check will run again when the server is back.",
      }
    : leaked > 0
    ? {
        icon: ShieldAlert,
        tone: "text-danger bg-danger/10",
        title: "Privacy check failed",
        body: `${plural(leaked, "private note")} found on the team server. Review your shared notes.`,
      }
    : {
        icon: ShieldCheck,
        tone: "text-ok bg-ok/10",
        title: isLoading ? "Checking privacy…" : "Privacy check passed",
        body: isLoading
          ? "Asking the team server what it holds."
          : `The team server holds ${plural(data?.shareable_on_server ?? 0, "shared note")} and none of your private ones.`,
      };

  const Icon = view.icon;

  return (
    <div className="card p-5">
      <div className="flex items-start gap-4">
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", view.tone)}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{view.title}</h3>
          <p className="text-sm text-muted mt-0.5">{view.body}</p>
        </div>
      </div>

      {detailed && data && !isError && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-line">
          <Stat label="Shared" value={data.shareable_on_server ?? 0} />
          <Stat label="Confirmed by 2+ devices" value={data.fleet_verified_on_server ?? 0} />
          <Stat label="Private" value={data.private_on_server ?? 0} bad={data.private_on_server > 0} />
          <Stat label="Temporary" value={data.routine_on_server ?? 0} bad={data.routine_on_server > 0} />
        </dl>
      )}
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums mt-0.5", bad && "text-danger")}>{value}</dd>
    </div>
  );
}
