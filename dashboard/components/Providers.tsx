"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; text: string };

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

// Lightweight notifications for the outcome of an action (saved, shared, refused, ...)
export function useToast() {
  return useContext(ToastContext);
}

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONE = { success: "text-ok", error: "text-danger", info: "text-accent" };

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000,
            refetchOnWindowFocus: true,
          },
        },
      })
  );
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (text: string, kind: ToastKind = "success") => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
    },
    [dismiss]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastContext.Provider value={push}>
        {children}
        <div
          aria-live="polite"
          className="fixed z-[60] bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm"
        >
          {toasts.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <div key={t.id} className="card shadow-pop flex items-start gap-3 px-4 py-3 animate-fade-in">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${TONE[t.kind]}`} />
                <p className="text-sm flex-1">{t.text}</p>
                <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg" aria-label="Dismiss">
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </ToastContext.Provider>
    </QueryClientProvider>
  );
}
