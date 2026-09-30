"use client";

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { category } from "@/lib/format";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
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
              active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card px-6 py-14 text-center">
      <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-subtle flex items-center justify-center">
        <Icon className="w-5 h-5 text-muted" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <p className="mt-1 text-sm text-muted max-w-sm mx-auto">{children}</p>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 space-y-2.5 animate-pulse">
          <div className="h-3.5 w-1/3 rounded bg-subtle" />
          <div className="h-3 w-4/5 rounded bg-subtle" />
        </div>
      ))}
    </div>
  );
}

export type MenuItem = {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
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
