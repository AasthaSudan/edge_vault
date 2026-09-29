"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { askStream, Source, AskEvent } from "@/lib/stream";
import { CitationChip } from "@/components/CitationChip";
import {
  Bot,
  Send,
  Plus,
  Trash2,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  Save,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  X,
  User,
} from "lucide-react";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  cited_ns?: number[];
  cited?: string[];
  grounded?: boolean;
  latency?: {
    retrieve?: number;
    first_token?: number | null;
    total?: number;
  };
  savedAs?: {
    category: string;
    reason: string;
  };
}

export default function AssistantPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"device" | "fleet">("device");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
  const [inspectSource, setInspectSource] = useState<Source | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch LLM status for top banner
  const { data: llmStatus } = useQuery({
    queryKey: ["llm-status"],
    queryFn: () => fetchEdge("/llm/status"),
    refetchInterval: 5000,
  });

  // Fetch chat sessions
  const { data: sessions, refetch: refetchSessions } = useQuery({
    queryKey: ["assistant-sessions"],
    queryFn: () => fetchEdge("/assistant/sessions"),
  });

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Handle new chat
  const handleNewChat = () => {
    setSessionId(null);
    setMessages([]);
    setInput("");
  };

  // Delete chat session
  const deleteSessionMutation = useMutation({
    mutationFn: (sid: string) => fetchEdge(`/assistant/sessions/${sid}`, { method: "DELETE" }),
    onSuccess: (_, sid) => {
      refetchSessions();
      if (sessionId === sid) {
        handleNewChat();
      }
    },
  });

  // Save message as memory with taint rule
  const saveMutation = useMutation({
    mutationFn: ({ messageId }: { messageId: string; index: number }) =>
      fetchEdge(`/assistant/messages/${messageId}/save`, { method: "POST" }),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["local-stats"] });
      setMessages((prev) => {
        const next = [...prev];
        if (next[variables.index]) {
          next[variables.index] = {
            ...next[variables.index],
            savedAs: {
              category: data.category,
              reason: data.gate_reason || data.reason || "Saved as memory",
            },
          };
        }
        return next;
      });
    },
  });

  // Send question
  const handleSubmit = async (e?: React.FormEvent, customQuestion?: string) => {
    if (e) e.preventDefault();
    const q = (customQuestion || input).trim();
    if (!q || isStreaming) return;

    setInput("");
    const userMsg: Message = { role: "user", content: q };
    const assistantIndex = messages.length + 1;
    const initialAssistantMsg: Message = { role: "assistant", content: "", sources: [] };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsStreaming(true);

    const edgeUrl = process.env.NEXT_PUBLIC_EDGE_API || "http://localhost:7001";

    try {
      let accumulatedText = "";
      let currentSources: Source[] = [];
      let currentSessionId = sessionId;

      for await (const ev of askStream(edgeUrl, {
        question: q,
        session_id: currentSessionId || undefined,
        scope,
      })) {
        if (ev.type === "sources") {
          currentSources = ev.sources;
          currentSessionId = ev.session_id;
          setSessionId(ev.session_id);
          refetchSessions();

          setMessages((prev) => {
            const next = [...prev];
            if (next[assistantIndex]) {
              next[assistantIndex] = {
                ...next[assistantIndex],
                sources: currentSources,
              };
            }
            return next;
          });
        } else if (ev.type === "token") {
          accumulatedText += ev.text;
          setMessages((prev) => {
            const next = [...prev];
            if (next[assistantIndex]) {
              next[assistantIndex] = {
                ...next[assistantIndex],
                content: accumulatedText,
              };
            }
            return next;
          });
        } else if (ev.type === "done") {
          setMessages((prev) => {
            const next = [...prev];
            if (next[assistantIndex]) {
              next[assistantIndex] = {
                ...next[assistantIndex],
                id: ev.message_id,
                content: accumulatedText,
                sources: currentSources,
                cited_ns: ev.cited_ns,
                cited: ev.cited,
                grounded: ev.grounded,
                latency: ev.latency_ms,
              };
            }
            return next;
          });
        }
      }
    } catch (err: any) {
      setMessages((prev) => {
        const next = [...prev];
        if (next[assistantIndex]) {
          next[assistantIndex] = {
            ...next[assistantIndex],
            content: `Error: ${err.message || "Failed to query on-device assistant."}`,
          };
        }
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  // Render assistant message content with clickable citation chips
  const renderFormattedText = (text: string, sources: Source[] = []) => {
    if (!text) return null;
    const parts = text.split(/(\[\d{1,2}\])/g);

    return parts.map((part, i) => {
      const match = part.match(/^\[(\d{1,2})\]$/);
      if (match) {
        const n = parseInt(match[1], 10);
        const source = sources.find((s) => s.n === n);
        return (
          <CitationChip
            key={i}
            n={n}
            source={source}
            onClick={(src) => setInspectSource(src || null)}
          />
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-8rem)] gap-4 max-w-6xl mx-auto">
      {/* Sessions Sidebar */}
      <div className="lg:w-64 flex flex-col panel p-3 shrink-0">
        <button
          onClick={handleNewChat}
          className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors shadow-xs mb-3 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>

        <div className="text-[11px] font-mono text-slate-500 px-2 py-1 uppercase flex items-center justify-between">
          <span>Sessions</span>
          <span>{sessions?.length || 0}</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 mt-1 pr-1">
          {sessions && sessions.length > 0 ? (
            sessions.map((s: any) => {
              const active = s.id === sessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => setSessionId(s.id)}
                  className={`group flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    active
                      ? "bg-slate-800 text-white font-medium"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="truncate font-sans text-xs">{s.title || "Untitled Chat"}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5 uppercase">
                      {s.scope}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSessionMutation.mutate(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-950/40 text-slate-500 hover:text-rose-400 transition-colors"
                    title="Delete session"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="p-4 text-center text-xs text-slate-500 italic">
              No previous chats yet.
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-border text-[11px] text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Local SQLite only. Never exported.</span>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col panel overflow-hidden">
        {/* Banner & Controls */}
        <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs text-slate-300 font-mono">
              On-Device Assistant ({llmStatus?.model || "qwen2.5:1.5b"})
            </span>
          </div>

          {/* Scope switch */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs font-mono">
            <button
              onClick={() => setScope("device")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                scope === "device"
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              This Device (Private + Fleet)
            </button>
            <button
              onClick={() => setScope("fleet")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                scope === "fleet"
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Fleet Only
            </button>
          </div>
        </div>

        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-6">
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400">
                <Bot className="w-5 h-5" />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-white">Ask EdgeVault</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Query local private records and synchronized fleet intelligence with verified numbered citations.
                </p>
              </div>

              {/* Sample Prompts */}
              <div className="w-full space-y-1.5 text-left">
                <span className="text-[11px] font-mono text-slate-500 uppercase block px-1">
                  Example Queries
                </span>
                <button
                  onClick={() => handleSubmit(undefined, "What is the Noida gate code and how do I fix a P-200 seal leak?")}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-xs text-slate-300 hover:text-white transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <span className="font-mono text-[11px]">What is the Noida gate code and how do I fix a P-200 seal leak?</span>
                  <Sparkles className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 transition-colors shrink-0" />
                </button>
                <button
                  onClick={() => handleSubmit(undefined, "How did we fix the turbine 4 bearing overheat?")}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-xs text-slate-300 hover:text-white transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <span className="font-mono text-[11px]">How did we fix the turbine 4 bearing overheat?</span>
                  <Sparkles className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 transition-colors shrink-0" />
                </button>
                <button
                  onClick={() => handleSubmit(undefined, "What is the torque spec for panel B bus bars?")}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-xs text-slate-300 hover:text-white transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <span className="font-mono text-[11px]">What is the torque spec for panel B bus bars?</span>
                  <Sparkles className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 transition-colors shrink-0" />
                </button>
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isUser = m.role === "user";
              const isExpanded = expandedSources[idx] || false;

              return (
                <div
                  key={idx}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-start gap-2 max-w-2xl">
                    {!isUser && (
                      <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400 shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                    )}

                    <div
                      className={`rounded-xl p-3 text-xs leading-relaxed ${
                        isUser
                          ? "bg-slate-800 text-white font-medium rounded-tr-xs"
                          : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-xs shadow-xs"
                      }`}
                    >
                      {isUser ? (
                        m.content
                      ) : (
                        <div className="space-y-2">
                          <div className="font-sans leading-relaxed text-xs whitespace-pre-wrap text-slate-200">
                            {renderFormattedText(m.content, m.sources)}
                          </div>

                          {/* Save feedback alert */}
                          {m.savedAs && (
                            <div className="mt-2 p-2 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 bg-rose-950/30 border-rose-800/40 text-rose-300">
                              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              <span>
                                <strong>{m.savedAs.category.toUpperCase()}:</strong> {m.savedAs.reason}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {isUser && (
                      <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0 mt-0.5">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>

                  {/* Assistant Footer & Sources Accordion */}
                  {!isUser && (
                    <div className="max-w-2xl w-full ml-9 mt-1.5 space-y-1.5 text-xs">
                      {/* Telemetry and Controls Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-slate-400">
                        <div className="flex items-center gap-2 text-[10px] font-mono">
                          {m.latency && (
                            <span>
                              retrieve {m.latency.retrieve || 0}ms · total {m.latency.total || 0}ms
                            </span>
                          )}
                          {m.grounded === false && (
                            <span className="text-amber-400 font-medium">
                              (Ungrounded)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Save as memory button */}
                          {m.id && !m.savedAs && (
                            <button
                              onClick={() => saveMutation.mutate({ messageId: m.id!, index: idx })}
                              disabled={saveMutation.isPending}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono border border-slate-700 transition-colors cursor-pointer"
                              title="Store this answer as an on-device memory with taint propagation"
                            >
                              <Save className="w-3 h-3 text-sky-400" />
                              <span>Save as memory</span>
                            </button>
                          )}

                          {/* Sources toggle */}
                          {m.sources && m.sources.length > 0 && (
                            <button
                              onClick={() =>
                                setExpandedSources((prev) => ({ ...prev, [idx]: !isExpanded }))
                              }
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                            >
                              <Layers className="w-3 h-3" />
                              <span>{m.sources.length} sources</span>
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Sources Drawer */}
                      {isExpanded && m.sources && m.sources.length > 0 && (
                        <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/90 space-y-1.5">
                          <div className="text-[10px] font-mono uppercase text-slate-500 font-semibold">
                            Retrieved Context Sources:
                          </div>
                          <div className="space-y-1">
                            {m.sources.map((s) => {
                              const isCited = m.cited_ns?.includes(s.n);
                              return (
                                <div
                                  key={s.n}
                                  onClick={() => setInspectSource(s)}
                                  className={`flex items-start justify-between gap-2 p-1.5 rounded border text-xs cursor-pointer transition-colors ${
                                    isCited
                                      ? "border-sky-800/60 bg-sky-950/20 text-slate-200"
                                      : "border-slate-800/60 text-slate-400 opacity-70 hover:opacity-100"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-xs font-semibold text-sky-400">
                                      [{s.n}]
                                    </span>
                                    <span className="font-medium truncate max-w-sm">
                                      {s.title || "Untitled Note"}
                                    </span>
                                    {s.asset_tag && (
                                      <span className="font-mono text-[9px] px-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                        {s.asset_tag}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`text-[9px] font-mono px-1 py-0.2 rounded uppercase border ${
                                        s.category === "private"
                                          ? "bg-rose-950/40 border-rose-800/40 text-rose-300"
                                          : s.category === "routine"
                                          ? "bg-slate-800/40 border-slate-700/40 text-slate-400"
                                          : "bg-sky-950/40 border-sky-800/40 text-sky-300"
                                      }`}
                                    >
                                      {s.category}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-500">
                                      {s.origin}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-border bg-slate-900/60 flex gap-2">
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
            placeholder={
              scope === "device"
                ? "Ask about device memory (e.g. Noida gate code, turbine overheating, torque specs)..."
                : "Ask about fleet knowledge (shared shard only)..."
            }
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-600 resize-none transition-colors"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>

      {/* Source Detail Modal */}
      {inspectSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold text-sky-400">
                  Source [{inspectSource.n}]
                </span>
                <span
                  className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded border ${
                    inspectSource.category === "private"
                      ? "bg-rose-950/40 border-rose-800/40 text-rose-300"
                      : inspectSource.category === "routine"
                      ? "bg-slate-800/40 border-slate-700/40 text-slate-400"
                      : "bg-sky-950/40 border-sky-800/40 text-sky-300"
                  }`}
                >
                  {inspectSource.category}
                </span>
              </div>
              <button
                onClick={() => setInspectSource(null)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-white">
                {inspectSource.title || "Untitled Note"}
              </div>
              <div className="text-xs font-mono text-slate-400 flex items-center gap-3">
                {inspectSource.asset_tag && (
                  <span>Asset: <strong>{inspectSource.asset_tag}</strong></span>
                )}
                <span>Origin: {inspectSource.origin}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
              <a
                href={`/memories?id=${inspectSource.memory_id}`}
                className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>View Note</span>
              </a>
              <button
                onClick={() => setInspectSource(null)}
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
