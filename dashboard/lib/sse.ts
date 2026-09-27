"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type EdgeEvent = {
  ts: number;
  type: string;
  memory_id?: string;
  data: Record<string, any>;
};

export function useEdgeEvents(base: string, max = 200) {
  const [events, setEvents] = useState<EdgeEvent[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${base}/events`);

      es.onmessage = (m) => {
        try {
          const ev: EdgeEvent = JSON.parse(m.data);
          setEvents((prev) => [ev, ...prev].slice(0, max));

          // Invalidate active queries when data mutations occur
          if (
            ev.type.startsWith("memory.") ||
            ev.type.startsWith("gate.") ||
            ev.type.startsWith("dedup.")
          ) {
            queryClient.invalidateQueries({ queryKey: ["memories"] });
            queryClient.invalidateQueries({ queryKey: ["local-stats"] });
          }
          if (ev.type.startsWith("sync.")) {
            queryClient.invalidateQueries({ queryKey: ["sync-status"] });
            queryClient.invalidateQueries({ queryKey: ["outbox"] });
            queryClient.invalidateQueries({ queryKey: ["cloud-stats"] });
            queryClient.invalidateQueries({ queryKey: ["memories"] });
          }
          if (ev.type.startsWith("conflict.")) {
            queryClient.invalidateQueries({ queryKey: ["conflicts"] });
          }
        } catch (err) {
          // Keep-alive or non-json message
        }
      };

      es.onerror = () => {
        // EventSource will automatically retry connecting
      };
    } catch (e) {
      console.error("SSE connection error", e);
    }

    return () => {
      if (es) es.close();
    };
  }, [base, max, queryClient]);

  return events;
}
