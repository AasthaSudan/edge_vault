"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CATEGORY, CATEGORY_ORDER, Category, category, plural } from "@/lib/format";
import { cn } from "./ui";

type Note = { created_at?: number | string; category?: string; asset_tag?: string };
type Counts = Record<Category, number>;

const zero = (): Counts => ({ shareable: 0, private: 0, routine: 0 });
const DAY = 86_400_000;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// The smallest round number at or above n (…, 100, 120, 150, 200, …) so the top gridline
// sits close to the tallest column; even, so the middle gridline is a whole number
function niceMax(n: number) {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10].find((s) => s * pow >= n) ?? 10;
  return step * pow;
}

// Notes created per day for the last `days` days, split by category
export function useDailyCounts(notes: Note[], days: number) {
  return useMemo(() => {
    const today = startOfDay(Date.now());
    const buckets = Array.from({ length: days }, (_, i) => {
      const day = today - (days - 1 - i) * DAY;
      return { day, counts: zero(), total: 0 };
    });
    for (const n of notes) {
      const t = Number(n.created_at);
      if (!t) continue;
      const i = days - 1 - Math.round((today - startOfDay(t)) / DAY);
      if (i < 0 || i >= days) continue;
      const k = category(n.category).key;
      buckets[i].counts[k] += 1;
      buckets[i].total += 1;
    }
    return buckets;
  }, [notes, days]);
}

export function Legend({ items }: { items: { key: string; label: string; value?: React.ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.key} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className={cn("w-2.5 h-2.5 rounded-[3px]", CATEGORY[i.key]?.dot ?? "bg-accent")} />
          {i.label}
          {i.value !== undefined && <span className="font-medium text-fg tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

function Readout({ title, counts }: { title: string; counts: Counts }) {
  const total = CATEGORY_ORDER.reduce((s, k) => s + counts[k], 0);
  return (
    <div className="card shadow-pop px-3 py-2.5 min-w-[150px] text-xs pointer-events-none">
      <div className="font-semibold text-fg mb-1.5">{title}</div>
      {CATEGORY_ORDER.map((k) => (
        <div key={k} className="flex items-center gap-2 py-0.5">
          <span className={cn("w-2 h-2 rounded-[2px]", CATEGORY[k].dot)} />
          <span className="flex-1 text-muted">{CATEGORY[k].label}</span>
          <span className="tabular-nums text-fg">{counts[k]}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-line mt-1.5 pt-1.5 text-muted">
        Total <span className="tabular-nums font-medium text-fg">{total}</span>
      </div>
    </div>
  );
}

const CHART_H = 168;

// Stacked columns: notes added per day, colored by who can see them
export function NotesTimeline({ notes, days = 14 }: { notes: Note[]; days?: number }) {
  const buckets = useDailyCounts(notes, days);
  const [hover, setHover] = useState<number | null>(null);
  // Dates depend on the viewer's clock and locale, so they're only drawn in the browser
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div style={{ height: CHART_H + 64 }} />;
  const max = niceMax(Math.max(0, ...buckets.map((b) => b.total)));
  const inPeriod = buckets.reduce((s, b) => s + b.total, 0);
  const totals = zero();
  buckets.forEach((b) => CATEGORY_ORDER.forEach((k) => (totals[k] += b.counts[k])));
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div>
      <Legend items={CATEGORY_ORDER.map((k) => ({ key: k, label: CATEGORY[k].label, value: totals[k] }))} />

      <div className="relative flex mt-5">
        {/* Y axis */}
        <div className="relative w-7 shrink-0 text-[11px] text-faint tabular-nums" style={{ height: CHART_H }}>
          {[max, max / 2, 0].map((v, i) => (
            <span key={i} className="absolute right-2 -translate-y-1/2" style={{ top: `${(i / 2) * 100}%` }}>
              {v}
            </span>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          {/* Gridlines */}
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: CHART_H }}>
            {[0, 50, 100].map((p) => (
              <div key={p} className={cn("absolute inset-x-0 h-px", p === 100 ? "bg-line-strong" : "bg-line/70")} style={{ top: `${p}%` }} />
            ))}
          </div>

          <div className="relative flex items-end" style={{ height: CHART_H }} onMouseLeave={() => setHover(null)}>
            {buckets.map((b, i) => {
              const stack = CATEGORY_ORDER.filter((k) => b.counts[k] > 0);
              const isToday = i === buckets.length - 1;
              return (
                <button
                  key={b.day}
                  type="button"
                  aria-label={`${fmt(b.day)}: ${plural(b.total, "note")}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className={cn("relative flex-1 h-full flex flex-col-reverse items-center gap-[2px] rounded-md outline-none", hover === i && "bg-subtle/70")}
                >
                  {stack.map((k, si) => (
                    <span
                      key={k}
                      className={cn(
                        "block w-full max-w-[24px] mx-auto transition-opacity",
                        CATEGORY[k].dot,
                        si === stack.length - 1 && "rounded-t-[4px]",
                        hover !== null && hover !== i && "opacity-60"
                      )}
                      style={{ height: Math.max(2, (b.counts[k] / max) * CHART_H - 2) }}
                    />
                  ))}
                  {hover === i && (
                    <span
                      className={cn(
                        "absolute bottom-full mb-2 z-10",
                        i < 3 ? "left-0" : i > buckets.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2"
                      )}
                    >
                      <Readout title={isToday ? `Today · ${fmt(b.day)}` : fmt(b.day)} counts={b.counts} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* X axis: day of the month */}
          <div className="flex mt-2 text-[10px] text-faint tabular-nums">
            {buckets.map((b, i) => (
              <span key={b.day} className={cn("flex-1 text-center", i === buckets.length - 1 && "text-fg font-semibold")}>
                {new Date(b.day).getDate()}
              </span>
            ))}
          </div>

          {inPeriod === 0 && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-center text-sm text-muted" style={{ height: CHART_H }}>
              No notes in the last {days} days
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Tiny single-series trend for a stat card
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - (v / max) * 26]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className={cn("relative h-8", className)}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
        <polygon points={`0,32 ${line} 100,32`} className="fill-accent/10" />
        <polyline points={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" />
      </svg>
      <span
        className="absolute w-2 h-2 rounded-full bg-accent ring-2 ring-surface -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${last[0]}%`, top: `${(last[1] / 32) * 100}%` }}
      />
    </div>
  );
}

// Horizontal stacked bars: which equipment has the most notes
export function EquipmentBars({ notes, top = 6 }: { notes: Note[]; top?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = useMemo(() => {
    const by = new Map<string, Counts>();
    for (const n of notes) {
      const tag = (n.asset_tag || "").trim();
      if (!tag) continue;
      const c = by.get(tag) ?? zero();
      c[category(n.category).key] += 1;
      by.set(tag, c);
    }
    return Array.from(by, ([tag, counts]) => ({ tag, counts, total: CATEGORY_ORDER.reduce((s, k) => s + counts[k], 0) }))
      .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag))
      .slice(0, top);
  }, [notes, top]);

  if (!rows.length) {
    return <p className="text-sm text-muted py-6 text-center">Tag notes with an equipment ID to see them here.</p>;
  }
  const max = rows[0].total;

  return (
    <ul className="space-y-2" onMouseLeave={() => setHover(null)}>
      {rows.map((r) => {
        const stack = CATEGORY_ORDER.filter((k) => r.counts[k] > 0);
        return (
          <li key={r.tag} className="relative">
            <Link
              href={`/memories?q=${encodeURIComponent(r.tag)}`}
              onMouseEnter={() => setHover(r.tag)}
              onFocus={() => setHover(r.tag)}
              onBlur={() => setHover(null)}
              className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-colors", hover === r.tag && "bg-subtle/70")}
            >
              <span className="w-24 shrink-0 text-sm font-medium truncate">{r.tag}</span>
              <span className="flex-1 min-w-0 flex items-center gap-2">
                <span className="flex h-5 gap-[2px]" style={{ width: `${(r.total / max) * 100}%` }}>
                  {stack.map((k, si) => (
                    <span
                      key={k}
                      className={cn("h-full", CATEGORY[k].dot, si === stack.length - 1 && "rounded-r-[4px]")}
                      style={{ width: `${(r.counts[k] / r.total) * 100}%` }}
                    />
                  ))}
                </span>
                <span className="text-xs text-muted tabular-nums shrink-0">{r.total}</span>
              </span>
            </Link>
            {hover === r.tag && (
              <span className="absolute right-0 bottom-full mb-1 z-10">
                <Readout title={r.tag} counts={r.counts} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
