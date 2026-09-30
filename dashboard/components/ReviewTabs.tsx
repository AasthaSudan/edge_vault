"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReviewCount } from "./Navbar";
import { PageHeader, cn } from "./ui";

// Header shared by the two review inboxes: share suggestions and sync conflicts
export function ReviewHeader({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname();
  const count = useReviewCount();
  const tabs = [
    { href: "/suggestions", label: "Suggestions", count: count.suggestions },
    { href: "/conflicts", label: "Conflicts", count: count.conflicts },
  ];

  return (
    <>
      <PageHeader title="Review" description="Decide what your team gets to see." />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <nav className="inline-flex items-center gap-1 p-1 rounded-xl bg-subtle ring-1 ring-line">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm transition-all",
                  active ? "bg-surface text-fg font-medium shadow-card" : "text-muted hover:text-fg"
                )}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-on-accent text-[11px] font-semibold flex items-center justify-center tabular-nums">
                    {t.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {actions}
      </div>
    </>
  );
}
