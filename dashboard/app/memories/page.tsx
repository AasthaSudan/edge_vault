"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Plus,
  Search,
  X,
  Lock,
  Users,
  Sparkles,
  Trash2,
  Clock,
  BadgeCheck,
  Loader2,
  ArrowLeft,
  FileText,
  ShieldCheck,
  History,
  Layers,
} from "lucide-react";
import { fetchEdge, POLL_MS } from "@/lib/api";
import { category, errorDetail, explain, plural, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import {
  CategoryBadge,
  EmptyState,
  IconTile,
  Menu,
  PageHeader,
  Skeleton,
  Tone,
  cn,
} from "@/components/ui";

type Filter = "" | "shareable" | "private" | "routine";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// useSearchParams needs a Suspense boundary so the rest of the page can still prerender
export default function NotesRoute() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <NotesPage />
    </Suspense>
  );
}

function NotesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [adding, setAdding] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // ?id=… shows one note (e.g. an answer's source); ?q=… comes from the header search;
  // ?new=1 from the header's New note button
  useEffect(() => {
    const id = params.get("id");
    const search = params.get("q");
    const isNew = params.get("new");
    if (id) {
      setFocusId(id);
      setOpenId(id);
    }
    if (search !== null) {
      setFocusId(null);
      setQuery(search);
    }
    if (isNew) setAdding(true);
    if (search !== null || isNew) window.history.replaceState(null, "", id ? `/memories?id=${id}` : "/memories");
  }, [params]);

  const { data: stats } = useQuery({
    queryKey: ["local-stats"],
    queryFn: () => fetchEdge("/stats/local"),
    refetchInterval: POLL_MS,
  });

  const list = useQuery({
    queryKey: ["memories", "list", filter],
    queryFn: () => fetchEdge(`/memories?limit=200${filter ? `&category=${filter}` : ""}`),
    refetchInterval: POLL_MS,
    enabled: !q && !focusId,
  });

  const search = useQuery({
    queryKey: ["memories", "search", q, filter],
    queryFn: () =>
      fetchEdge("/search", {
        method: "POST",
        body: JSON.stringify({ q, mode: "hybrid", category: filter || null, limit: 25 }),
      }),
    enabled: !!q && !focusId,
    placeholderData: keepPreviousData,
  });

  const focused = useQuery({
    queryKey: ["memories", "one", focusId],
    queryFn: () => fetchEdge(`/memories/${focusId}`),
    enabled: !!focusId,
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["memories"] });
    qc.invalidateQueries({ queryKey: ["local-stats"] });
    qc.invalidateQueries({ queryKey: ["sync-status"] });
  };

  const overrideMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      fetchEdge(`/memories/${id}/category`, { method: "POST", body: JSON.stringify({ category }) }),
    onSuccess: (_, v) => {
      refresh();
      toast(v.category === "shareable" ? "Shared with your team" : "Made private. It will be removed from your team.");
    },
    onError: (err) => toast(errorDetail(err), "error"),
  });

  const reclassifyMutation = useMutation({
    mutationFn: (id: string) => fetchEdge(`/memories/${id}/reclassify`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast("Checking again with the on-device AI", "info");
    },
    onError: (err) => toast(errorDetail(err), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetchEdge(`/memories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast("Note deleted");
      if (focusId) showAll();
    },
    onError: (err) => toast(errorDetail(err), "error"),
  });

  const showAll = () => {
    setFocusId(null);
    window.history.replaceState(null, "", "/memories");
  };

  const active = focusId ? focused : q ? search : list;
  const notes: any[] = focusId
    ? focused.data
      ? [focused.data]
      : []
    : q
    ? search.data?.results ?? []
    : Array.isArray(list.data)
    ? list.data
    : [];

  const actionsFor = (m: any) => [
    {
      label: "Share with team",
      icon: Users,
      // The edge refuses to share a note that matched a privacy rule
      hidden: m.category === "shareable" || m.pii_hits?.length > 0,
      onClick: () => overrideMutation.mutate({ id: m.memory_id, category: "shareable" }),
    },
    {
      label: "Make private",
      icon: Lock,
      hidden: m.category !== "shareable",
      onClick: () => overrideMutation.mutate({ id: m.memory_id, category: "private" }),
    },
    {
      label: "Check again with AI",
      icon: Sparkles,
      hidden: m.gate_source !== "fallback",
      onClick: () => reclassifyMutation.mutate(m.memory_id),
    },
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      onClick: () => {
        if (confirm("Delete this note? This can't be undone.")) deleteMutation.mutate(m.memory_id);
      },
    },
  ];

  const filters: { value: Filter; label: string; hint: string; count?: number; icon: typeof FileText; tone: Tone }[] = [
    { value: "", label: "All notes", hint: "On this device", count: stats?.total, icon: Layers, tone: "accent" },
    { value: "shareable", label: "Shared", hint: "Visible to your team", count: stats?.shareable, icon: Users, tone: "shared" },
    { value: "private", label: "Private", hint: "Never leaves this device", count: stats?.private, icon: Lock, tone: "private" },
    { value: "routine", label: "Temporary", hint: "Deleted after 14 days", count: stats?.routine, icon: Clock, tone: "temp" },
  ];

  return (
    <div>
      <PageHeader
        title="Notes"
        description="Everything you've logged on this device, and who can see it."
        actions={
          !adding && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus className="w-4 h-4" />
              New note
            </button>
          )
        }
      />

      {adding && (
        <NewNoteForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {focusId ? (
        <button onClick={showAll} className="btn btn-secondary btn-sm mb-4">
          <ArrowLeft className="w-4 h-4" />
          All notes
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" role="tablist" aria-label="Filter notes">
            {filters.map((f) => {
              const selected = filter === f.value;
              return (
                <button
                  key={f.value || "all"}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "card text-left p-4 flex items-center gap-3 transition-all",
                    selected ? "ring-2 ring-accent/50 border-accent/40 shadow-lift" : "hover:border-line-strong hover:shadow-lift"
                  )}
                >
                  <IconTile icon={f.icon} tone={f.tone} />
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-xl font-semibold tabular-nums leading-none">{f.count ?? "–"}</span>
                      <span className="text-sm font-medium truncate">{f.label}</span>
                    </span>
                    <span className="block text-xs text-muted mt-1 truncate">{f.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative mb-4">
            <Search className="w-4 h-4 text-faint absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by problem, fix or equipment"
              aria-label="Search notes"
              className="input h-12 pl-11 pr-11 rounded-xl shadow-card text-[15px]"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 btn-icon w-7 h-7"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </>
      )}

      {q && !focusId && !active.isLoading && (
        <p className="mb-3 px-1 text-xs text-muted">
          {search.isFetching && !search.data
            ? "Searching…"
            : `${plural(notes.length, "best match", "best matches")} for “${q}”`}
        </p>
      )}

      {active.isLoading ? (
        <Skeleton rows={4} />
      ) : focusId && focused.isError ? (
        <EmptyState icon={FileText} title="Note not found">
          It may have been deleted or merged into another note.
        </EmptyState>
      ) : notes.length === 0 ? (
        q ? (
          <EmptyState icon={Search} title="No matching notes">
            Try different words, or check the spelling of an equipment tag.
          </EmptyState>
        ) : (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            action={
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus className="w-4 h-4" />
                Write your first note
              </button>
            }
          >
            Log what you observe and fix. EdgeVault keeps anything sensitive on this device.
          </EmptyState>
        )
      ) : (
        <ul className="card divide-y divide-line">
          {notes.map((m) => (
            <NoteRow
              key={m.memory_id}
              note={m}
              open={openId === m.memory_id}
              onToggle={() => setOpenId((id) => (id === m.memory_id ? null : m.memory_id))}
              actions={actionsFor(m)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({
  note: m,
  open,
  onToggle,
  actions,
}: {
  note: any;
  open: boolean;
  onToggle: () => void;
  actions: React.ComponentProps<typeof Menu>["items"];
}) {
  const c = category(m.category);
  const checking = m.gate_source === "pending";
  const verifiedBy = m.corroboration_count ?? m.corroborated_by?.length ?? 0;
  const when = m.updated_at || m.created_at;

  return (
    <li
      className={cn("first:rounded-t-2xl last:rounded-b-2xl transition-colors", open ? "bg-subtle/50" : "hover:bg-subtle/40")}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex items-start gap-4 pl-5 pr-3 sm:pr-4 py-4 cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          {m.title && <div className="text-sm font-semibold mb-0.5">{m.title}</div>}
          <p className={cn("text-sm leading-relaxed", m.title ? "text-muted" : "text-fg", !open && "line-clamp-2")}>{m.text}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-xs text-muted">
            {m.asset_tag && <span className="tag">{m.asset_tag}</span>}
            <span>
              {m.author ? `${m.author} · ` : ""}
              {timeAgo(when)}
            </span>
            {checking && (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking privacy
              </span>
            )}
            {m.sync_state === "pending" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 h-5 text-warn">
                <Clock className="w-3 h-3" />
                Waiting to sync
              </span>
            )}
            {m.fleet_verified && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 h-5 text-ok"
                title={`Also reported by: ${(m.corroborated_by || []).join(", ")}`}
              >
                <BadgeCheck className="w-3.5 h-3.5" />
                Confirmed by {verifiedBy} devices
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!checking && <CategoryBadge value={m.category} className="hidden sm:inline-flex" />}
          <span className={cn("sm:hidden w-2 h-2 rounded-full mr-1", c.dot)} title={c.label} />
          <Menu items={actions} />
        </div>
      </div>

      {open && (
        <div className="grid sm:grid-cols-3 gap-3 px-5 pb-4 -mt-1 animate-fade-in">
          <Detail icon={ShieldCheck} label={`Why it's ${c.label.toLowerCase()}`} className="sm:col-span-2">
            {explain(m)}
          </Detail>
          {m.expires_at ? (
            <Detail icon={Clock} label="Deleted on">
              {new Date(Number(m.expires_at)).toLocaleDateString()}
            </Detail>
          ) : (
            <Detail icon={History} label="Edits">
              {m.version > 1 ? `Edited ${m.version - 1} time${m.version === 2 ? "" : "s"}` : "Original"}
              {m.merged_from?.length ? ` · merged ${m.merged_from.length} similar` : ""}
            </Detail>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-surface ring-1 ring-line px-4 py-3", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm mt-1">{children}</div>
    </div>
  );
}

const VISIBILITY: { value: string; label: string; hint: string; icon: typeof Users; tone: Tone }[] = [
  { value: "auto", label: "Decide for me", hint: "The on-device AI checks it", icon: Sparkles, tone: "accent" },
  { value: "shareable", label: "My team", hint: "Shared when it's safe", icon: Users, tone: "shared" },
  { value: "private", label: "Only me", hint: "Stays on this device", icon: Lock, tone: "private" },
  { value: "routine", label: "Only me, 14 days", hint: "Then deleted", icon: Clock, tone: "temp" },
];

function NewNoteForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [asset, setAsset] = useState("");
  const [visibility, setVisibility] = useState("auto");

  const create = useMutation({
    mutationFn: () =>
      fetchEdge("/memories", {
        method: "POST",
        body: JSON.stringify({
          text,
          title,
          asset_tag: asset.trim().toUpperCase(),
          category: visibility === "auto" ? null : visibility,
        }),
      }),
    onSuccess: (data: any) => {
      onSaved();
      if (data?.gate_source === "pending") toast("Note saved. Checking whether it's safe to share…");
      else toast(`Note saved as ${category(data?.category).label.toLowerCase()}`);
    },
    onError: (err) => toast(`Couldn't save: ${errorDetail(err)}`, "error"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) create.mutate();
      }}
      className="card mb-6 animate-fade-in overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-line bg-subtle/40">
        <IconTile icon={Plus} size="sm" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">New note</h2>
          <p className="text-xs text-muted">What did you observe, fix or learn?</p>
        </div>
        <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        <div>
          <label htmlFor="note-text" className="label">
            Note
          </label>
          <textarea
            id="note-text"
            autoFocus
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. P-200 seal leak fixed by replacing the lip seal with a Viton seal."
            className="input"
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="note-title" className="label">
              Title <span className="text-faint font-normal">(optional)</span>
            </label>
            <input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </div>
          <div>
            <label htmlFor="note-asset" className="label">
              Equipment <span className="text-faint font-normal">(optional)</span>
            </label>
            <input
              id="note-asset"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              placeholder="e.g. P-200"
              className="input uppercase placeholder:normal-case"
            />
          </div>
        </div>

        <fieldset>
          <legend className="label">Who can see it</legend>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {VISIBILITY.map((v) => {
              const selected = visibility === v.value;
              return (
                <label
                  key={v.value}
                  className={cn(
                    "relative flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all",
                    selected ? "border-accent/50 ring-2 ring-accent/30 bg-accent/5" : "border-line hover:border-line-strong"
                  )}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={v.value}
                    checked={selected}
                    onChange={() => setVisibility(v.value)}
                    className="sr-only"
                  />
                  <IconTile icon={v.icon} tone={v.tone} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{v.label}</span>
                    <span className="block text-xs text-muted">{v.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-line bg-subtle/40">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-ok" />
          Passwords, codes and personal details are never shared, whatever you pick.
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={!text.trim() || create.isPending} className="btn btn-primary">
            {create.isPending ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </form>
  );
}
