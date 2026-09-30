"use client";

import { createContext, createElement, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EDGE_API } from "@/lib/api";

export type EdgeEvent = {
  ts: number;
  type: string;
  memory_id?: string;
  data: Record<string, any>;
};

// Which cached queries an edge event makes stale. Pages refresh from these events instead of
// polling every few seconds.
const NOTES = ["memories", "local-stats", "sync-status", "outbox"];
const STALE_BY_PREFIX: [string, string[]][] = [
  ["memory.", NOTES],
  ["gate.", NOTES],
  ["dedup.", NOTES],
  ["ttl.", NOTES],
  ["privacy.", NOTES],
  ["share.", [...NOTES, "suggestions", "pending-suggestions"]],
  ["sync.", [...NOTES, "cloud-stats"]],
  ["conflict.", ["conflicts", "conflict-analysis", "sync-status"]],
  ["assistant.", ["assistant-sessions"]],
];

// Separate contexts: the nav only needs "connected", and must not re-render on every event.
const EventsContext = createContext<EdgeEvent[]>([]);
const ConnectedContext = createContext(false);

// A note produces several events within a few ms (created, decided, queued, ...). Collect the
// stale keys and refetch once per burst instead of once per event.
const INVALIDATE_DELAY_MS = 150;

// One EventSource for the whole app. Each open one holds one of the browser's six
// connections to the edge, so per-page streams would make ordinary requests queue.
export function EdgeEventsProvider({ children, max = 200 }: { children: React.ReactNode; max?: number }) {
  const [events, setEvents] = useState<EdgeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let es: EventSource | null = null;
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      pending.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      pending.clear();
    };
    try {
      es = new EventSource(`${EDGE_API}/events`);
      es.onopen = () => setConnected(true);

      es.onmessage = (m) => {
        try {
          const ev: EdgeEvent = JSON.parse(m.data);
          setEvents((prev) => [ev, ...prev].slice(0, max));

          for (const [prefix, keys] of STALE_BY_PREFIX) {
            if (ev.type.startsWith(prefix)) keys.forEach((k) => pending.add(k));
          }
          if (pending.size && !timer) timer = setTimeout(flush, INVALIDATE_DELAY_MS);
        } catch (err) {
          // Keep-alive or non-json message
        }
      };

      es.onerror = () => {
        // EventSource retries on its own; onopen flips this back
        setConnected(false);
      };
    } catch (e) {
      console.error("SSE connection error", e);
    }

    return () => {
      if (es) es.close();
      if (timer) clearTimeout(timer);
    };
  }, [max, queryClient]);

  return createElement(
    ConnectedContext.Provider,
    { value: connected },
    createElement(EventsContext.Provider, { value: events }, children)
  );
}

export function useEdgeEvents() {
  return { events: useContext(EventsContext), connected: useContext(ConnectedContext) };
}

export function useEdgeConnected() {
  return useContext(ConnectedContext);
}
