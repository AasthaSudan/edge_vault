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
      <div className="flex items-center justify-between gap-4 border-b border-line mb-6">
        <nav className="flex gap-6 -mb-px">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "inline-flex items-center gap-2 pb-3 text-sm border-b-2 transition-colors",
                  active ? "border-fg text-fg font-medium" : "border-transparent text-muted hover:text-fg"
                )}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[11px] font-semibold flex items-center justify-center tabular-nums">
                    {t.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {actions && <div className="pb-2">{actions}</div>}
      </div>
    </>
  );
}
