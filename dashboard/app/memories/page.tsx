"use client";

import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import { fetchEdge } from "@/lib/api";
import { category, errorDetail, explain, timeAgo } from "@/lib/format";
import { useToast } from "@/components/Providers";
import { CategoryLabel, EmptyState, Menu, PageHeader, Segmented, Skeleton, cn } from "@/components/ui";

type Filter = "" | "shareable" | "private" | "routine";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function NotesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [adding, setAdding] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // /memories?id=… (e.g. from an answer's source) shows that one note
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      setFocusId(id);
      setOpenId(id);
    }
  }, []);

  const { data: stats } = useQuery({
    queryKey: ["local-stats"],
    queryFn: () => fetchEdge("/stats/local"),
    refetchInterval: 5000,
  });

  const list = useQuery({
    queryKey: ["memories", "list", filter],
    queryFn: () => fetchEdge(`/memories?limit=200${filter ? `&category=${filter}` : ""}`),
    refetchInterval: 5000,
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

  return (
    <div>
      <PageHeader
        title="Notes"
        description="Everything you've logged on this device."
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
        <button onClick={showAll} className="btn btn-ghost btn-sm -ml-3 mb-3">
          <ArrowLeft className="w-4 h-4" />
          All notes
        </button>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by problem, fix or equipment"
              className="input pl-9 pr-9"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon w-6 h-6"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "", label: "All", count: stats?.total },
                { value: "shareable", label: "Shared", count: stats?.shareable },
                { value: "private", label: "Private", count: stats?.private },
                { value: "routine", label: "Temporary", count: stats?.routine },
              ]}
            />
          </div>
        </div>
      )}

      {q && !focusId && (
        <p className="text-sm text-muted mb-3">
          {search.isFetching && !search.data ? "Searching…" : `Best matches for “${q}”`}
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
          <EmptyState icon={FileText} title="No notes yet">
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
    <li className="first:rounded-t-xl last:rounded-b-xl hover:bg-subtle/60 transition-colors">
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
        className="flex items-start gap-4 px-4 sm:px-5 py-4 cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          {m.title && <div className="text-sm font-medium mb-0.5">{m.title}</div>}
          <p className={cn("text-sm leading-relaxed", m.title ? "text-muted" : "text-fg", !open && "line-clamp-2")}>
            {m.text}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-xs text-muted">
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
              <span className="inline-flex items-center gap-1 text-warn">
                <Clock className="w-3 h-3" />
                Waiting to sync
              </span>
            )}
            {m.fleet_verified && (
              <span
                className="inline-flex items-center gap-1 text-ok"
                title={`Also reported by: ${(m.corroborated_by || []).join(", ")}`}
              >
                <BadgeCheck className="w-3.5 h-3.5" />
                Confirmed by {verifiedBy} devices
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 -mr-2">
          {!checking && <CategoryLabel value={m.category} className="hidden sm:inline-flex" />}
          <span className={cn("sm:hidden w-2 h-2 rounded-full mr-1", c.dot)} title={c.label} />
          <Menu items={actions} />
        </div>
      </div>

      {open && (
        <dl className="mx-4 sm:mx-5 mb-4 -mt-1 grid sm:grid-cols-2 gap-x-6 gap-y-3 rounded-lg bg-subtle px-4 py-3 text-sm animate-fade-in">
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Why it&apos;s {c.label.toLowerCase()}</dt>
            <dd className="mt-0.5">{explain(m)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Who can see it</dt>
            <dd className="mt-0.5">{c.hint}</dd>
          </div>
          {m.expires_at ? (
            <div>
              <dt className="text-xs text-muted">Deleted on</dt>
              <dd className="mt-0.5">{new Date(Number(m.expires_at)).toLocaleDateString()}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs text-muted">Edits</dt>
              <dd className="mt-0.5">
                {m.version > 1 ? `Edited ${m.version - 1} time${m.version === 2 ? "" : "s"}` : "Original"}
                {m.merged_from?.length ? ` · merged ${m.merged_from.length} similar` : ""}
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

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
      className="card p-5 mb-6 space-y-4 animate-fade-in"
    >
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
          placeholder="What did you observe, fix or learn?"
          className="input"
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
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
        <div>
          <label htmlFor="note-visibility" className="label">
            Who can see it
          </label>
          <select
            id="note-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="input pr-8"
          >
            <option value="auto">Decide for me</option>
            <option value="shareable">My team</option>
            <option value="private">Only me</option>
            <option value="routine">Only me, for 14 days</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
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
