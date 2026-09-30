"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { plural } from "@/lib/format";
import { Avatar, cn, Segmented, StatusDot } from "./ui";

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("ev-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem("ev-theme");
    else localStorage.setItem("ev-theme", t);
  } catch {}
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// One compact status button in the header; the details live in its popover.
export function StatusMenu() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setTheme(readTheme()), []);

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

  const { data: sync, isError: edgeDown } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchEdge("/sync/status"),
    refetchInterval: POLL_MS,
  });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchEdge("/health"),
    refetchInterval: POLL_MS,
  });
  const { data: llm, isError: llmDown } = useQuery({
    queryKey: ["llm-status"],
    queryFn: () => fetchEdge("/llm/status"),
    refetchInterval: 15_000, // no edge event when Ollama loads or unloads the model
  });

  const offlineMutation = useMutation({
    mutationFn: (on: boolean) => fetchEdge(`/sync/offline?on=${on}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-status"] }),
  });

  const offline = !!sync?.forced_offline;
  const waiting = sync?.outbox_depth ?? 0;
  // "loaded" lists models held in memory; Ollama unloads idle ones, so empty means standby
  const aiReady = !llmDown && (llm?.loaded?.length ?? 0) > 0;

  const state = edgeDown
    ? { label: "Disconnected", dot: "bg-danger" }
    : !sync
    ? { label: "Connecting", dot: "bg-faint" }
    : offline
    ? { label: "Offline", dot: "bg-warn" }
    : { label: "Online", dot: "bg-ok" };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-8 pl-3 pr-2 rounded-full border border-line bg-surface text-[13px] font-medium shadow-card hover:bg-subtle transition-colors"
      >
        <StatusDot className={state.dot} pulse={state.label === "Online"} />
        <span>{state.label}</span>
        {waiting > 0 && !edgeDown && (
          <span className="hidden sm:inline text-muted font-normal">· {waiting} waiting</span>
        )}
        <ChevronDown className={cn("w-3.5 h-3.5 text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 card shadow-pop animate-fade-in">
          <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-line">
            <Avatar name={health?.author} />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{health?.author ?? "This device"}</div>
              <div className="text-xs text-muted truncate">{health?.device_id ?? "Not connected"}</div>
            </div>
          </div>

          <div className="p-4 space-y-4 text-sm">
            {edgeDown ? (
              <p className="text-muted">
                Can&apos;t reach the EdgeVault service on this device. Check that it&apos;s running.
              </p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <span>
                    <span className="block font-medium">Offline mode</span>
                    <span className="block text-xs text-muted mt-0.5">Pause syncing with your team</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={offline}
                    disabled={offlineMutation.isPending}
                    onClick={() => offlineMutation.mutate(!offline)}
                    className={cn(
                      "relative w-9 h-5 rounded-full transition-colors shrink-0",
                      offline ? "bg-warn" : "bg-line-strong"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        offline && "translate-x-4"
                      )}
                    />
                  </button>
                </label>

                <div className="flex items-center justify-between">
                  <span className="font-medium">AI assistant</span>
                  <span
                    className="inline-flex items-center gap-1.5 text-xs text-muted"
                    title={aiReady ? llm?.model : "Loads on first use"}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", aiReady ? "bg-ok" : "bg-faint")} />
                    {aiReady ? "Ready" : "Standby"}
                  </span>
                </div>

                <Link
                  href="/sync"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between hover:text-accent transition-colors"
                >
                  <span className="font-medium">Waiting to sync</span>
                  <span className="text-xs text-muted">{waiting ? plural(waiting, "note") : "Nothing"}</span>
                </Link>
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-line flex items-center justify-between">
            <span className="text-xs text-muted">Appearance</span>
            <Segmented
              size="sm"
              value={theme}
              onChange={(t) => {
                setTheme(t);
                applyTheme(t);
              }}
              options={[
                { value: "system", label: <Monitor className="w-3.5 h-3.5" aria-label="System" /> },
                { value: "light", label: <Sun className="w-3.5 h-3.5" aria-label="Light" /> },
                { value: "dark", label: <Moon className="w-3.5 h-3.5" aria-label="Dark" /> },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
