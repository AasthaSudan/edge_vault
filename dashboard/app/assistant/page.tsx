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
} from "lucide-react";
import { fetchEdge, EDGE_API } from "@/lib/api";
import { askStream, Source } from "@/lib/stream";
import { category, errorDetail, timeAgo } from "@/lib/format";
import { CitationChip } from "@/components/CitationChip";
import { useToast } from "@/components/Providers";
import { CategoryLabel, Segmented, cn } from "@/components/ui";

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

const EXAMPLES = [
  "How did we fix the turbine 4 bearing overheat?",
  "What is the torque spec for panel B bus bars?",
  "What fixed the P-200 seal leak?",
];

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Grow the composer with its content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
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
    <ul className="space-y-0.5">
      {Array.isArray(sessions) && sessions.length > 0 ? (
        sessions.map((s: any) => (
          <li key={s.id}>
            <div
              className={cn(
                "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                s.id === sessionId ? "bg-subtle" : "hover:bg-subtle"
              )}
            >
              <button
                type="button"
                onClick={() => openSession(s.id)}
                className="flex-1 min-w-0 text-left px-2.5 py-2"
              >
                <span className={cn("block text-sm truncate", s.id === sessionId ? "text-fg font-medium" : "text-muted")}>
                  {s.title || "Untitled chat"}
                </span>
                <span className="block text-xs text-faint mt-0.5">{timeAgo(s.updated_at)}</span>
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
        ))
      ) : (
        <li className="px-2.5 py-2 text-sm text-faint">No chats yet</li>
      )}
    </ul>
  );

  return (
    <div className="flex -mt-8 sm:-mt-10 -mb-28 md:-mb-16 h-[calc(100dvh-7.5rem)] md:h-[calc(100dvh-3.5rem)]">
      {/* Chat history */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-line pr-4 py-6">
        <button onClick={newChat} className="btn btn-secondary w-full">
          <Plus className="w-4 h-4" />
          New chat
        </button>
        <div className="text-xs font-medium text-faint mt-6 mb-2 px-2.5">Recent</div>
        <div className="flex-1 overflow-y-auto -mr-2 pr-2">{sessionList}</div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col lg:pl-6">
        {/* Mobile / tablet chat controls */}
        <div className="lg:hidden relative flex items-center justify-between pt-4">
          <button onClick={() => setHistoryOpen((o) => !o)} className="btn btn-ghost btn-sm -ml-2">
            <History className="w-4 h-4" />
            Chats
          </button>
          <button onClick={newChat} className="btn btn-ghost btn-sm -mr-2">
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
          <div className="max-w-2xl mx-auto py-8 space-y-8">
            {messages.length === 0 ? (
              <div className="pt-[8vh] text-center">
                <div className="mx-auto w-11 h-11 rounded-full bg-subtle flex items-center justify-center mb-5">
                  <MessageSquare className="w-5 h-5 text-muted" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">What do you need to know?</h1>
                <p className="mt-2 text-muted text-sm max-w-md mx-auto">
                  Answers come from your notes and your team&apos;s knowledge, with sources you can check.
                </p>
                <div className="mt-8 grid gap-2 max-w-md mx-auto text-left">
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSubmit(undefined, q)}
                      className="group flex items-center justify-between gap-3 card px-4 py-3 text-left text-sm text-muted hover:text-fg hover:border-line-strong transition-colors"
                    >
                      {q}
                      <ArrowRight className="w-4 h-4 text-faint group-hover:text-fg shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, idx) =>
                m.role === "user" ? (
                  <div key={idx} className="flex justify-end animate-fade-in">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-subtle px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
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
        <div className="pb-4 md:pb-6">
          <form
            onSubmit={handleSubmit}
            className="max-w-2xl mx-auto card rounded-2xl p-2 shadow-sm focus-within:border-line-strong transition-colors"
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
                className="w-8 h-8 rounded-lg bg-fg text-bg flex items-center justify-center disabled:opacity-30 transition-opacity"
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
      <div className="flex items-start gap-2.5 text-sm text-danger animate-fade-in">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{m.content}</span>
      </div>
    );
  }

  if (!m.content) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted animate-fade-in">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-muted animate-blink"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
        {sources.length ? "Writing an answer…" : "Searching your notes…"}
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="text-[15px] leading-7 whitespace-pre-wrap">
        {renderText(m.content, sources)}
        {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-fg/60 align-[-2px] animate-pulse" />}
      </div>

      {done && m.grounded === false && (
        <p className="flex items-center gap-1.5 text-xs text-warn">
          <AlertTriangle className="w-3.5 h-3.5" />
          Not backed by any of your notes. Treat with care.
        </p>
      )}

      {done && sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((s) => (
            <button
              key={s.n}
              onClick={() => onInspect(s)}
              className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 max-w-[260px] rounded-lg border border-line bg-surface text-xs text-muted hover:text-fg hover:bg-subtle transition-colors"
            >
              <span className={cn("w-4 h-4 rounded text-[10px] font-semibold flex items-center justify-center bg-subtle", category(s.category).text)}>
                {s.n}
              </span>
              <span className="truncate">{s.title || s.asset_tag || "Untitled note"}</span>
            </button>
          ))}
          {sources.length > cited.length && (
            <button onClick={() => setShowAll((v) => !v)} className="h-7 px-2 text-xs text-faint hover:text-fg transition-colors">
              {showAll
                ? "Show fewer"
                : cited.length
                ? `+${sources.length - cited.length} more`
                : `${sources.length} related notes`}
            </button>
          )}
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="card w-full sm:max-w-lg rounded-b-none sm:rounded-xl shadow-pop p-6 animate-fade-in"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-faint mb-1">Source {source.n}</div>
            <h2 className="text-base font-semibold leading-snug">{source.title || "Untitled note"}</h2>
          </div>
          <button onClick={onClose} className="btn-icon -mr-2 -mt-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
          <CategoryLabel value={source.category} />
          {source.asset_tag && <span className="tag">{source.asset_tag}</span>}
          <span className="text-xs text-muted">{fromHere ? "From this device" : `From ${source.origin}`}</span>
          {source.fleet_verified && (
            <span className="inline-flex items-center gap-1 text-xs text-ok">
              <BadgeCheck className="w-3.5 h-3.5" />
              Confirmed by {verifiedBy} devices
            </span>
          )}
        </div>

        {source.text && (
          <p className="mt-4 text-sm leading-relaxed text-fg/90 bg-subtle rounded-lg p-4">{source.text}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn btn-ghost">
            Close
          </button>
          <Link href={`/memories?id=${source.memory_id}`} className="btn btn-secondary">
            Open note
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
