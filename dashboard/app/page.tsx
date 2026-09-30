"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUp, CheckCircle2, GitMerge, Inbox, CloudUpload } from "lucide-react";
import { fetchEdge } from "@/lib/api";
import { greeting, plural } from "@/lib/format";
import { PrivacyCheck } from "@/components/PrivacyCheck";
import { useReviewCount } from "@/components/Navbar";
import { cn } from "@/components/ui";

export default function HomePage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [hello, setHello] = useState("Welcome");
  useEffect(() => setHello(greeting()), []);

  const { data: stats } = useQuery({
    queryKey: ["local-stats"],
    queryFn: () => fetchEdge("/stats/local"),
    refetchInterval: 5000,
  });
  const { data: sync } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: 2500,
  });
  const review = useReviewCount();

  const total = stats?.total ?? 0;
  const parts = [
    { key: "shareable", label: "Shared", value: stats?.shareable ?? 0, color: "bg-accent" },
    { key: "private", label: "Private", value: stats?.private ?? 0, color: "bg-private" },
    { key: "routine", label: "Temporary", value: stats?.routine ?? 0, color: "bg-warn" },
  ];

  const waiting = sync?.outbox_depth ?? 0;
  const todo = [
    review.suggestions > 0 && {
      href: "/suggestions",
      icon: Inbox,
      text: `${plural(review.suggestions, "suggestion")} to review`,
      hint: "Safe facts found in your private notes",
    },
    review.conflicts > 0 && {
      href: "/conflicts",
      icon: GitMerge,
      text: `${plural(review.conflicts, "conflict")} to resolve`,
      hint: "Two devices edited the same note",
    },
    waiting > 0 && {
      href: "/sync",
      icon: CloudUpload,
      text: `${plural(waiting, "note")} waiting to sync`,
      hint: sync?.forced_offline ? "Will send when you're back online" : "Sending shortly",
    },
  ].filter(Boolean) as { href: string; icon: React.ComponentType<{ className?: string }>; text: string; hint: string }[];

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q) router.push(`/assistant?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          {hello}
          {stats?.author ? `, ${stats.author}` : ""}
        </h1>
        <p className="mt-1.5 text-muted">
          Your notes stay on this device. Only knowledge that&apos;s safe to share reaches your team.
        </p>
      </div>

      <form onSubmit={ask} className="relative">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your equipment…"
          className="input h-14 pl-5 pr-14 text-[15px] rounded-2xl shadow-sm"
        />
        <button
          type="submit"
          disabled={!question.trim()}
          aria-label="Ask"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-fg text-bg flex items-center justify-center disabled:opacity-30 transition-opacity"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-5">
        {/* Notes breakdown */}
        <Link href="/memories" className="card p-5 md:col-span-3 group hover:border-line-strong transition-colors">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm text-muted">Notes on this device</div>
              <div className="text-3xl font-semibold tracking-tight tabular-nums mt-1">{total}</div>
            </div>
            <ArrowRight className="w-4 h-4 text-faint group-hover:text-fg transition-colors" />
          </div>

          <div className="flex h-2 rounded-full overflow-hidden bg-subtle mt-5 gap-0.5">
            {total > 0 &&
              parts.map(
                (p) =>
                  p.value > 0 && (
                    <div key={p.key} className={p.color} style={{ width: `${(p.value / total) * 100}%` }} />
                  )
              )}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
            {parts.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5 text-sm text-muted">
                <span className={cn("w-2 h-2 rounded-full", p.color)} />
                {p.label}
                <span className="text-fg font-medium tabular-nums">{p.value}</span>
              </span>
            ))}
          </div>
        </Link>

        {/* Needs attention */}
        <div className="card md:col-span-2 flex flex-col">
          <div className="px-5 pt-5 pb-2 text-sm text-muted">Needs your attention</div>
          {todo.length === 0 ? (
            <div className="flex-1 flex items-center gap-3 px-5 pb-5 pt-1">
              <CheckCircle2 className="w-5 h-5 text-ok shrink-0" />
              <div>
                <div className="text-sm font-medium">You&apos;re all caught up</div>
                <div className="text-sm text-muted">Nothing to review right now.</div>
              </div>
            </div>
          ) : (
            <ul className="pb-2">
              {todo.map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-subtle transition-colors group"
                    >
                      <Icon className="w-4 h-4 text-muted shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{t.text}</span>
                        <span className="block text-xs text-muted truncate">{t.hint}</span>
                      </span>
                      <ArrowRight className="w-4 h-4 text-faint group-hover:text-fg transition-colors" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <PrivacyCheck />
    </div>
  );
}
