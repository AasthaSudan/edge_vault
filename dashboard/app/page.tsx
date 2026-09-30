"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CloudUpload,
  FileText,
  GitMerge,
  Inbox,
  Info,
  Lock,
  Shield,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { DEMO_MODE, LOCAL_SETUP_URL } from "@/lib/demo";
import { exampleQuestions, greeting, percent, plural, timeAgo } from "@/lib/format";
import { useReviewCount } from "@/components/Navbar";
import { EquipmentBars, NotesTimeline, Sparkline, useDailyCounts } from "@/components/Charts";
import {
  CategoryBadge,
  IconTile,
  Meter,
  Panel,
  PanelLink,
  StatCard,
} from "@/components/ui";

export default function HomePage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [hello, setHello] = useState("Welcome");
  useEffect(() => setHello(greeting()), []);

  const { data: stats } = useQuery({
    queryKey: ["local-stats"],
    queryFn: () => fetchEdge("/stats/local"),
    refetchInterval: POLL_MS,
  });
  const { data: sync } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: POLL_MS,
  });
  // Same query as the Notes page's unfiltered list, so the two share one cache entry
  const { data: list } = useQuery({
    queryKey: ["memories", "list", ""],
    queryFn: () => fetchEdge("/memories?limit=200"),
    refetchInterval: POLL_MS,
  });
  const review = useReviewCount();

  const notes: any[] = Array.isArray(list) ? list : [];
  const examples = exampleQuestions(notes);
  const total = stats?.total ?? 0;
  const shared = stats?.shareable ?? 0;
  const kept = (stats?.private ?? 0) + (stats?.routine ?? 0);
  const daily = useDailyCounts(notes, 14);
  const lastWeek = daily.slice(-7).reduce((s, d) => s + d.total, 0);

  const offline = !!sync?.forced_offline;
  const waiting = sync?.outbox_depth ?? 0;

  const recent = [...notes]
    .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0))
    .slice(0, 5);

  const todo = [
    review.suggestions > 0 && {
      href: "/suggestions",
      icon: Inbox,
      tone: "accent" as const,
      text: `${plural(review.suggestions, "suggestion")} to review`,
      hint: "Safe facts found in your private notes",
    },
    review.conflicts > 0 && {
      href: "/conflicts",
      icon: GitMerge,
      tone: "warn" as const,
      text: `${plural(review.conflicts, "conflict")} to resolve`,
      hint: "Two devices edited the same note",
    },
    waiting > 0 && {
      href: "/sync",
      icon: CloudUpload,
      tone: "shared" as const,
      text: `${plural(waiting, "note")} waiting to sync`,
      hint: offline ? "Will send when you're back online" : "Sending shortly",
    },
  ].filter(Boolean) as {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: "accent" | "warn" | "shared";
    text: string;
    hint: string;
  }[];

  const ask = (e: React.FormEvent, custom?: string) => {
    e.preventDefault();
    const q = (custom ?? question).trim();
    if (q) router.push(`/assistant?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <section className="hero relative overflow-hidden rounded-3xl text-hero shadow-lift ring-1 ring-inset ring-hero/10">
        <Shield className="absolute -right-10 -top-10 w-72 h-72 text-hero/[0.05] pointer-events-none" strokeWidth={1.2} />

        <div className="relative p-6 sm:p-8 lg:p-10">
          <h1 className="text-[26px] leading-tight sm:text-4xl font-semibold tracking-tight">
            {hello}
            {stats?.author ? `, ${stats.author}` : ""}
          </h1>
          <p className="mt-2 text-hero/65 max-w-xl">
            Your notes stay on this device. Only knowledge that&apos;s safe to share reaches your team.
          </p>

          {DEMO_MODE ? (
            // The hosted demo has no on-device LLM, so asking is switched off there
            <div className="mt-6 max-w-2xl flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl bg-hero/[0.05] ring-1 ring-inset ring-hero/15 px-4 py-3.5">
              <Info className="w-5 h-5 text-warn shrink-0" />
              <p className="flex-1 text-sm text-hero/80">
                <span className="font-semibold text-hero">Asking questions is off in this AWS demo.</span> It runs without
                the on-device AI (local LLM). Run EdgeVault locally to try the assistant.
              </p>
              <a
                href={LOCAL_SETUP_URL}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl bg-fg text-bg text-sm font-medium hover:bg-fg/85 transition"
              >
                Run it locally
                <ArrowUpRight className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <>
              <form onSubmit={ask} className="relative mt-6 max-w-2xl">
                <Sparkles className="w-5 h-5 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask anything about your equipment…"
                  aria-label="Ask a question"
                  className="w-full h-14 rounded-2xl bg-white text-zinc-900 placeholder:text-zinc-500 pl-12 pr-16 text-[15px] shadow-lg outline-none ring-1 ring-hero/10 focus:ring-4 focus:ring-hero/15 transition"
                />
                <button
                  type="submit"
                  disabled={!question.trim()}
                  aria-label="Ask"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-700 disabled:opacity-30 transition"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </form>

              {/* Built from the notes on this device; one swipeable row on phones, wrapping on wider screens */}
              {examples.length > 0 && (
                <div className="scroll-x flex sm:flex-wrap gap-2 mt-4 -mx-6 px-6 sm:mx-0 sm:px-0">
                  {examples.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={(e) => ask(e, q)}
                      className="shrink-0 h-8 px-3 rounded-full bg-hero/[0.06] ring-1 ring-inset ring-hero/10 text-xs font-medium text-hero/75 hover:bg-hero/[0.12] hover:text-hero transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="col-span-2 lg:col-span-1 grid">
          <StatCard icon={FileText} label="Notes on this device" value={total} href="/memories" sub={`+${lastWeek} in the last 7 days`}>
            <Sparkline values={daily.map((d) => d.total)} className="mt-4" />
          </StatCard>
        </div>
        <StatCard
          icon={Users}
          tone="shared"
          label="Shared with team"
          value={shared}
          href="/memories"
          sub={`${percent(shared, total)}% of your notes`}
        >
          <Meter value={percent(shared, total)} fill="bg-shared" className="mt-6" />
        </StatCard>
        <StatCard
          icon={Lock}
          tone="private"
          label="Kept on this device"
          value={kept}
          href="/memories"
          sub={`${stats?.private ?? 0} private · ${stats?.routine ?? 0} temporary`}
        >
          <Meter value={percent(kept, total)} fill="bg-private" className="mt-6" />
        </StatCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Notes added"
          description="Last 14 days, by who can see them"
          icon={BarChart3}
          className="lg:col-span-2"
        >
          <NotesTimeline notes={notes} />
        </Panel>

        <Panel title="Most-logged equipment" description="Select one to see its notes" icon={Wrench}>
          <EquipmentBars notes={notes} top={6} />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Recent notes"
          icon={FileText}
          className="lg:col-span-2"
          bodyClassName="px-0 pt-3 pb-2"
          action={<PanelLink href="/memories">View all</PanelLink>}
        >
          {recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No notes yet. Log what you observe and fix.</p>
          ) : (
            <ul>
              {recent.map((m) => (
                <li key={m.memory_id}>
                  <Link
                    href={`/memories?id=${m.memory_id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-subtle/60 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{m.title || m.text}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted min-w-0">
                        {m.asset_tag && <span className="tag shrink-0">{m.asset_tag}</span>}
                        <span className="truncate">{m.title ? m.text : timeAgo(m.updated_at || m.created_at)}</span>
                      </div>
                    </div>
                    <CategoryBadge value={m.category} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Needs your attention" icon={Inbox} bodyClassName={todo.length ? "px-2 pt-3 pb-2" : undefined}>
          {todo.length === 0 ? (
            <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center">
              <IconTile icon={CheckCircle2} tone="ok" size="lg" />
              <div className="text-sm font-medium mt-3">You&apos;re all caught up</div>
              <div className="text-sm text-muted">Nothing to review right now.</div>
            </div>
          ) : (
            <ul>
              {todo.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-subtle transition-colors">
                    <IconTile icon={t.icon} tone={t.tone} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{t.text}</span>
                      <span className="block text-xs text-muted truncate">{t.hint}</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-faint group-hover:text-fg group-hover:translate-x-0.5 transition" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
