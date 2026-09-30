"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Plus,
  Trash2,
  Copy,
  Check,
  BookmarkPlus,
  AlertTriangle,
  X,
  ArrowRight,
  BadgeCheck,
  History,
  MessageSquare,
  Sparkles,
  Wrench,
  Gauge,
  Droplets,
  Thermometer,
} from "lucide-react";
import { fetchEdge, EDGE_API, POLL_MS } from "@/lib/api";
import { askStream, Source } from "@/lib/stream";
import { category, errorDetail, exampleQuestions, timeAgo } from "@/lib/format";
import { CitationChip } from "@/components/CitationChip";
import { useToast } from "@/components/Providers";
import { CategoryBadge, CategoryLabel, IconTile, Segmented, cn } from "@/components/ui";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  cited_ns?: number[];
  grounded?: boolean;
  error?: boolean;
  savedAs?: { category: string; reason: string };
}

type Scope = "device" | "fleet";

// Icons for the example questions, which are built from the notes on this device
const EXAMPLE_ICONS = [Wrench, Gauge, Droplets, Thermometer];

function Bot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-on-accent flex items-center justify-center shrink-0 shadow-glow",
        className
      )}
    >
      <Sparkles className="w-4 h-4" />
    </span>
  );
}

export default function AskPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<Scope>("device");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [inspect, setInspect] = useState<Source | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  const { data: sessions, refetch: refetchSessions } = useQuery({
    queryKey: ["assistant-sessions"],
    queryFn: () => fetchEdge("/assistant/sessions"),
  });
  // Same query as Home and Notes, so the examples come from cached notes
  const { data: noteList, isSuccess: notesLoaded } = useQuery({
    queryKey: ["memories", "list", ""],
    queryFn: () => fetchEdge("/memories?limit=200"),
    refetchInterval: POLL_MS,
  });
  const examples = exampleQuestions(Array.isArray(noteList) ? noteList : [], 4);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Grow the composer with its content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Empty: keep the one-row height. Measuring then would size the box to its placeholder,
    // possibly before layout settles (a near-zero width wraps it into a 200px tower).
    if (input) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // A question typed on the Home page arrives as ?q=
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      window.history.replaceState(null, "", "/assistant");
      handleSubmit(undefined, q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setHistoryOpen(false);
    textareaRef.current?.focus();
  };

  const openSession = async (sid: string) => {
    setHistoryOpen(false);
    if (sid === sessionId || isStreaming) return;
    try {
      const d = await fetchEdge(`/assistant/sessions/${sid}`);
      setSessionId(sid);
      if (d.session?.scope === "fleet" || d.session?.scope === "device") setScope(d.session.scope);
      setMessages(
        (d.messages ?? []).map((m: any): Message => {
          const sources: Source[] = m.sources ?? [];
          const cited: string[] = m.cited ?? [];
          const isAssistant = m.role === "assistant";
          return {
            id: isAssistant ? m.id : undefined,
            role: m.role,
            content: m.content,
            sources,
            cited_ns: sources.filter((s) => cited.includes(s.memory_id)).map((s) => s.n),
            // Mirrors the edge's rule: grounded when something was cited, or when it declined
            grounded: isAssistant ? cited.length > 0 || m.content.startsWith("I don't have") : undefined,
          };
        })
      );
    } catch (err) {
      toast(`Couldn't open that chat: ${errorDetail(err)}`, "error");
    }
  };

  const deleteSession = useMutation({
    mutationFn: (sid: string) => fetchEdge(`/assistant/sessions/${sid}`, { method: "DELETE" }),
    onSuccess: (_, sid) => {
      refetchSessions();
      if (sessionId === sid) newChat();
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ messageId }: { messageId: string; index: number }) =>
      fetchEdge(`/assistant/messages/${messageId}/save`, { method: "POST" }),
    onSuccess: (data, { index }) => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["local-stats"] });
      const savedAs = { category: data.category, reason: data.gate_reason || data.reason || "" };
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, savedAs } : m)));
      toast(`Saved as a ${category(data.category).label.toLowerCase()} note`);
    },
    onError: (err) => toast(`Couldn't save: ${errorDetail(err)}`, "error"),
  });

  const handleSubmit = async (e?: React.FormEvent, custom?: string) => {
    if (e) e.preventDefault();
    const q = (custom ?? input).trim();
    if (!q || isStreaming) return;

    setInput("");
    const assistantIndex = messages.length + 1;
    const patch = (p: Partial<Message>) =>
      setMessages((prev) => prev.map((m, i) => (i === assistantIndex ? { ...m, ...p } : m)));

    setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", sources: [] }]);
    setIsStreaming(true);

    try {
      let text = "";
      let sources: Source[] = [];
      for await (const ev of askStream(EDGE_API, { question: q, session_id: sessionId || undefined, scope })) {
        if (ev.type === "sources") {
          sources = ev.sources;
          setSessionId(ev.session_id);
          refetchSessions();
          patch({ sources });
        } else if (ev.type === "token") {
          text += ev.text;
          patch({ content: text });
        } else if (ev.type === "done") {
          patch({
            id: ev.message_id,
            content: ev.text ?? text,
            sources,
            cited_ns: ev.cited_ns,
            grounded: ev.grounded,
          });
        }
      }
    } catch (err: any) {
      patch({ content: err?.message || "The on-device assistant didn't respond.", error: true });
    } finally {
      setIsStreaming(false);
    }
  };

  const renderText = (text: string, sources: Source[] = []) =>
    text.split(/(\[\d{1,2}\])/g).map((part, i) => {
      const match = part.match(/^\[(\d{1,2})\]$/);
      if (!match) return <span key={i}>{part}</span>;
      const n = parseInt(match[1], 10);
      return <CitationChip key={i} n={n} source={sources.find((s) => s.n === n)} onClick={setInspect} />;
    });

  const sessionList = (
    <ul className="space-y-1">
      {Array.isArray(sessions) && sessions.length > 0 ? (
        sessions.map((s: any) => {
          const active = s.id === sessionId;
          return (
            <li key={s.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-xl pr-1 transition-colors",
                  active ? "bg-surface shadow-card ring-1 ring-line" : "hover:bg-surface/70"
                )}
              >
                <button type="button" onClick={() => openSession(s.id)} className="flex-1 min-w-0 flex items-start gap-2.5 text-left px-3 py-2.5">
                  <MessageSquare className={cn("w-4 h-4 mt-0.5 shrink-0", active ? "text-accent" : "text-faint")} />
                  <span className="min-w-0">
                    <span className={cn("block text-sm truncate", active ? "text-fg font-medium" : "text-muted")}>
                      {s.title || "Untitled chat"}
                    </span>
                    <span className="block text-xs text-faint mt-0.5">{timeAgo(s.updated_at)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteSession.mutate(s.id)}
                  className="btn-icon w-7 h-7 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          );
        })
      ) : (
        <li className="px-3 py-6 text-center text-sm text-faint">
          <MessageSquare className="w-5 h-5 mx-auto mb-2" />
          No chats yet
        </li>
      )}
    </ul>
  );

  return (
    <div className="flex -mt-6 sm:-mt-8 -mb-28 lg:-mb-12 h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-4rem)]">
      {/* Chat history */}
      <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-line pr-5 py-6">
        <button onClick={newChat} className="btn btn-primary w-full h-10">
          <Plus className="w-4 h-4" />
          New chat
        </button>
        <div className="eyebrow mt-7 mb-2 px-3">Recent chats</div>
        <div className="flex-1 overflow-y-auto -mr-2 pr-2">{sessionList}</div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col lg:pl-8">
        {/* Mobile / tablet chat controls */}
        <div className="lg:hidden relative flex items-center justify-between pt-4">
          <button onClick={() => setHistoryOpen((o) => !o)} className="btn btn-secondary btn-sm">
            <History className="w-4 h-4" />
            Chats
          </button>
          <button onClick={newChat} className="btn btn-primary btn-sm">
            <Plus className="w-4 h-4" />
            New chat
          </button>
          {historyOpen && (
            <div className="absolute left-0 right-0 top-14 z-30 card shadow-pop p-1.5 max-h-[60vh] overflow-y-auto animate-fade-in">
              {sessionList}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-8 space-y-8">
            {messages.length === 0 ? (
              <div className="pt-[5vh] text-center">
                <div className="relative mx-auto w-fit mb-6">
                  <span className="absolute inset-0 -m-4 rounded-[28px] bg-accent/10 blur-xl" />
                  <span className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-accent-2 text-on-accent flex items-center justify-center shadow-glow">
                    <Sparkles className="w-7 h-7" />
                  </span>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight">What do you need to know?</h1>
                <p className="mt-2 text-muted max-w-md mx-auto">
                  Answers come from your notes and your team&apos;s knowledge, with sources you can check.
                </p>

                {examples.length > 0 ? (
                  <div className="mt-10 grid sm:grid-cols-2 gap-3 text-left">
                    {examples.map((q, i) => (
                      <button
                        key={q}
                        onClick={() => handleSubmit(undefined, q)}
                        className="group card card-link flex items-start gap-3 p-4 text-left"
                      >
                        <IconTile icon={EXAMPLE_ICONS[i % EXAMPLE_ICONS.length]} size="sm" />
                        <span className="flex-1 text-sm leading-snug text-fg/90 pt-1.5">{q}</span>
                        <ArrowRight className="w-4 h-4 mt-2 text-faint group-hover:text-accent group-hover:translate-x-0.5 shrink-0 transition" />
                      </button>
                    ))}
                  </div>
                ) : (
                  notesLoaded && (
                    <p className="mt-10 text-sm text-muted">
                      There are no notes to answer from yet.{" "}
                      <Link href="/memories?new=1" className="font-medium text-fg underline underline-offset-4">
                        Add your first note
                      </Link>
                    </p>
                  )
                )}
              </div>
            ) : (
              messages.map((m, idx) =>
                m.role === "user" ? (
                  <div key={idx} className="flex justify-end animate-fade-in">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-subtle ring-1 ring-line px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <AssistantMessage
                    key={idx}
                    m={m}
                    streaming={isStreaming && idx === messages.length - 1}
                    renderText={renderText}
                    onInspect={setInspect}
                    onSave={() => m.id && saveMutation.mutate({ messageId: m.id, index: idx })}
                    saving={saveMutation.isPending && saveMutation.variables?.index === idx}
                  />
                )
              )
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="pb-4 lg:pb-6">
          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto card rounded-2xl p-2.5 shadow-lift focus-within:border-accent/40 focus-within:ring-4 focus-within:ring-accent/10 transition"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={scope === "device" ? "Ask about your notes…" : "Ask about your team's shared knowledge…"}
              rows={1}
              className="w-full bg-transparent resize-none outline-none px-2.5 pt-2 pb-1 text-[15px] placeholder:text-faint"
            />
            <div className="flex items-center justify-between gap-2 pl-1">
              <Segmented<Scope>
                size="sm"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "device", label: "All my notes" },
                  { value: "fleet", label: "Team only" },
                ]}
              />
              <button
                type="submit"
                disabled={isStreaming || !input.trim()}
                aria-label="Send"
                className="w-9 h-9 rounded-xl bg-accent text-on-accent flex items-center justify-center hover:shadow-glow disabled:opacity-30 disabled:shadow-none transition"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </form>
          <p className="text-center text-xs text-faint mt-2">
            Runs entirely on this device. Check the sources before acting on an answer.
          </p>
        </div>
      </section>

      {inspect && <SourceDialog source={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}

function AssistantMessage({
  m,
  streaming,
  renderText,
  onInspect,
  onSave,
  saving,
}: {
  m: Message;
  streaming: boolean;
  renderText: (t: string, s?: Source[]) => React.ReactNode;
  onInspect: (s: Source) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const sources = m.sources ?? [];
  const cited = sources.filter((s) => m.cited_ns?.includes(s.n));
  const shown = showAll ? sources : cited;
  const done = !!m.id;

  if (m.error) {
    return (
      <div className="flex items-start gap-3 animate-fade-in">
        <span className="w-8 h-8 rounded-xl bg-danger/10 text-danger flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </span>
        <div className="rounded-xl bg-danger/5 ring-1 ring-danger/20 px-4 py-3 text-sm text-danger">{m.content}</div>
      </div>
    );
  }

  if (!m.content) {
    return (
      <div className="flex items-center gap-3 animate-fade-in">
        <Bot />
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent animate-blink" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
          {sources.length ? "Writing an answer…" : "Searching your notes…"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <Bot />
      <div className="flex-1 min-w-0 space-y-3 pt-1">
        <div className="text-[15px] leading-7 whitespace-pre-wrap">
          {renderText(m.content, sources)}
          {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent/70 align-[-2px] animate-pulse" />}
        </div>

        {/* A greeting has no sources to be backed by, so it gets no warning */}
        {done && m.grounded === false && sources.length > 0 && (
          <p className="inline-flex items-center gap-1.5 rounded-lg bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
            <AlertTriangle className="w-3.5 h-3.5" />
            Not backed by any of your notes. Treat with care.
          </p>
        )}

        {done && sources.length > 0 && (
          <div>
            <div className="eyebrow mb-2">Sources</div>
            <div className="flex flex-wrap items-center gap-2">
              {shown.map((s) => (
                <button
                  key={s.n}
                  onClick={() => onInspect(s)}
                  className="inline-flex items-center gap-2 h-8 pl-1.5 pr-3 max-w-[280px] rounded-lg border border-line bg-surface shadow-card text-xs text-muted hover:text-fg hover:border-line-strong transition-colors"
                >
                  <span className={cn("w-5 h-5 rounded-md text-[11px] font-semibold flex items-center justify-center text-fg", category(s.category).soft)}>
                    {s.n}
                  </span>
                  <span className="truncate">{s.title || s.asset_tag || "Untitled note"}</span>
                  {s.fleet_verified && <BadgeCheck className="w-3.5 h-3.5 text-ok shrink-0" />}
                </button>
              ))}
              {sources.length > cited.length && (
                <button onClick={() => setShowAll((v) => !v)} className="h-8 px-2 text-xs text-muted hover:text-fg transition-colors">
                  {showAll ? "Show fewer" : cited.length ? `+${sources.length - cited.length} more` : `${sources.length} related notes`}
                </button>
              )}
            </div>
          </div>
        )}

        {done && (
          <div className="flex items-center gap-1 -ml-2">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(m.content.replace(/\s?\[\d{1,2}\]/g, ""));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="btn btn-ghost h-7 px-2 text-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            {m.savedAs ? (
              <span className="inline-flex items-center gap-1.5 h-7 px-2 text-xs text-muted">
                <Check className="w-3.5 h-3.5 text-ok" />
                Saved as <CategoryLabel value={m.savedAs.category} />
              </span>
            ) : (
              <button
                onClick={onSave}
                disabled={saving}
                className="btn btn-ghost h-7 px-2 text-xs"
                title="Keep this answer as a note. It stays private if any source was private."
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                {saving ? "Saving…" : "Save as note"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceDialog({ source, onClose }: { source: Source; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const fromHere = !source.origin || source.origin === "this device";
  const verifiedBy = source.corroborated_by?.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="card w-full sm:max-w-lg rounded-b-none sm:rounded-2xl shadow-pop p-6 animate-fade-in"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className={cn("w-9 h-9 rounded-xl text-sm font-semibold flex items-center justify-center shrink-0", category(source.category).soft)}>
              {source.n}
            </span>
            <div className="min-w-0">
              <div className="text-xs text-muted mb-0.5">Source {source.n}</div>
              <h2 className="text-base font-semibold leading-snug">{source.title || "Untitled note"}</h2>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon -mr-2 -mt-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <CategoryBadge value={source.category} />
          {source.asset_tag && <span className="tag">{source.asset_tag}</span>}
          <span className="text-xs text-muted">{fromHere ? "From this device" : `From ${source.origin}`}</span>
          {source.fleet_verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 h-6 text-xs text-ok">
              <BadgeCheck className="w-3.5 h-3.5" />
              Confirmed by {verifiedBy} devices
            </span>
          )}
        </div>

        {source.text && (
          <p className="mt-4 text-sm leading-relaxed text-fg/90 bg-subtle rounded-xl p-4 ring-1 ring-line">{source.text}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn btn-ghost">
            Close
          </button>
          <Link href={`/memories?id=${source.memory_id}`} className="btn btn-primary">
            Open note
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
