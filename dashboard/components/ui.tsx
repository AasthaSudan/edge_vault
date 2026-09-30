"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock, Lock, MoreHorizontal, Users } from "lucide-react";
import { category, initials } from "@/lib/format";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type IconType = React.ComponentType<{ className?: string }>;

export type Tone = "accent" | "shared" | "private" | "temp" | "ok" | "warn" | "danger" | "neutral";

// Literal class names so Tailwind keeps them
const TONE: Record<Tone, string> = {
  accent: "bg-accent/10 text-accent ring-accent/15",
  shared: "bg-shared/10 text-shared ring-shared/15",
  private: "bg-private/10 text-private ring-private/15",
  temp: "bg-temp/15 text-temp ring-temp/20",
  ok: "bg-ok/10 text-ok ring-ok/15",
  warn: "bg-warn/10 text-warn ring-warn/15",
  danger: "bg-danger/10 text-danger ring-danger/15",
  neutral: "bg-subtle text-muted ring-line",
};

const CATEGORY_ICON: Record<string, IconType> = { shareable: Users, private: Lock, routine: Clock };

export function IconTile({
  icon: Icon,
  tone = "accent",
  size = "md",
  className,
}: {
  icon: IconType;
  tone?: Tone;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const box = {
    xs: "w-5 h-5 rounded-md",
    sm: "w-8 h-8 rounded-lg",
    md: "w-10 h-10 rounded-xl",
    lg: "w-12 h-12 rounded-2xl",
  }[size];
  const glyph = { xs: "w-3 h-3", sm: "w-4 h-4", md: "w-5 h-5", lg: "w-6 h-6" }[size];
  return (
    <span className={cn("inline-flex items-center justify-center shrink-0 ring-1 ring-inset", box, TONE[tone], className)}>
      <Icon className={glyph} />
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// A card with a titled header row
export function Panel({
  title,
  description,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconType;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const Icon = icon;
  return (
    // min-w-0: as a grid item it must shrink to its column, or long truncated lines widen the page
    <section className={cn("card flex flex-col min-w-0", className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {Icon && <Icon className="w-4 h-4 text-muted" />}
            {title}
          </h2>
          {description && <p className="text-xs text-muted mt-1">{description}</p>}
        </div>
        {action && <div className="shrink-0 -mt-1">{action}</div>}
      </header>
      <div className={cn("flex-1 p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 h-7 px-2 -mr-2 rounded-md text-xs font-medium text-muted hover:text-fg hover:bg-subtle transition-colors"
    >
      {children}
      <ArrowUpRight className="w-3.5 h-3.5" />
    </Link>
  );
}

export function StatCard({
  icon,
  tone = "accent",
  label,
  value,
  sub,
  href,
  children,
}: {
  icon: IconType;
  tone?: Tone;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-muted">{label}</div>
          <div className="text-[28px] leading-none font-semibold tracking-tight mt-2.5">{value}</div>
        </div>
        <IconTile icon={icon} tone={tone} />
      </div>
      {children}
      {/* Pinned to the bottom so a row of cards lines up whatever sits above */}
      {sub && <div className="text-xs text-muted mt-auto pt-3">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card card-link p-5 flex flex-col">
      {body}
    </Link>
  ) : (
    <div className="card p-5 flex flex-col">{body}</div>
  );
}

// A thin horizontal gauge, one hue
export function Meter({ value, className, fill = "bg-accent" }: { value: number; className?: string; fill?: string }) {
  return (
    <div className={cn("h-1.5 rounded-full bg-subtle overflow-hidden", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", fill)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Avatar({ name, size = "md", className }: { name?: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex items-center justify-center shrink-0 rounded-full font-semibold text-on-accent bg-gradient-to-br from-accent to-accent-2",
        size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

export function CategoryLabel({ value, className }: { value?: string; className?: string }) {
  const c = category(value);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-muted", className)} title={c.hint}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

// Tinted pill with the category's icon; the text stays in text ink
export function CategoryBadge({ value, className }: { value?: string; className?: string }) {
  const c = category(value);
  const Icon = CATEGORY_ICON[c.key];
  return (
    <span
      title={c.hint}
      className={cn("inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full text-xs font-medium text-fg/80", c.soft, className)}
    >
      <Icon className={cn("w-3.5 h-3.5", c.text)} />
      {c.label}
    </span>
  );
}

export function StatusDot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex w-2 h-2 shrink-0">
      {pulse && <span className={cn("absolute inset-0 rounded-full animate-ping", className)} />}
      <span className={cn("relative w-2 h-2 rounded-full", className)} />
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: React.ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-subtle border border-line" role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors whitespace-nowrap",
              size === "sm" ? "px-2.5 h-7 text-xs" : "px-3 h-8 text-[13px]",
              active ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg"
            )}
          >
            {o.label}
            {!!o.count && (
              <span className={cn("text-[11px] tabular-nums", active ? "text-muted" : "text-faint")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  tone = "accent",
  action,
  className,
}: {
  icon: IconType;
  title: string;
  children?: React.ReactNode;
  tone?: Tone;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card px-6 py-14 text-center", className)}>
      <div className="relative mx-auto mb-5 w-fit">
        <span className="absolute inset-0 -m-3 rounded-3xl bg-accent/5" />
        <IconTile icon={Icon} tone={tone} size="lg" className="relative" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1.5 text-sm text-muted max-w-sm mx-auto">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-5 flex gap-4 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-subtle shrink-0" />
          <div className="flex-1 space-y-2.5">
            <div className="h-3.5 w-1/3 rounded bg-subtle" />
            <div className="h-3 w-4/5 rounded bg-subtle" />
          </div>
        </div>
      ))}
    </div>
  );
}

export type MenuItem = {
  label: string;
  icon?: IconType;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
};

export function Menu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn-icon" aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-52 card shadow-pop p-1 animate-fade-in">
          {items
            .filter((i) => !i.hidden)
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-md text-sm text-left transition-colors",
                    item.danger ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-subtle"
                  )}
                >
                  {Icon && <Icon className={cn("w-4 h-4", item.danger ? "" : "text-muted")} />}
                  {item.label}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
