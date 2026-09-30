// Plain-language labels for the edge node's technical vocabulary.

export type Category = "shareable" | "private" | "routine";

export const CATEGORY: Record<string, { label: string; dot: string; text: string; hint: string }> = {
  shareable: { label: "Shared", dot: "bg-accent", text: "text-accent", hint: "Visible to your team" },
  private: { label: "Private", dot: "bg-private", text: "text-private", hint: "Stays on this device" },
  routine: { label: "Temporary", dot: "bg-warn", text: "text-warn", hint: "Deleted after 14 days" },
};

export function category(c?: string) {
  return CATEGORY[(c || "private").toLowerCase()] ?? CATEGORY.private;
}

// Mirrors the rule names in edge/gate/pii.py
const PII_LABEL: Record<string, string> = {
  phone: "a phone number",
  email: "an email address",
  access_code: "an access code",
  password: "a password",
  id_number: "an ID number",
  money: "an amount of money",
  address: "a home address",
  lock_combination: "a lock combination",
  named_person: "a person's name",
  sensitive_request: "a sensitive request",
};

export function piiLabel(hit: string) {
  return PII_LABEL[hit] ?? hit.replace(/_/g, " ");
}

function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function sentence(s?: string) {
  const r = (s || "").replace(/^veto:\s*/i, "").trim();
  if (!r) return "";
  return `${r.charAt(0).toUpperCase()}${r.slice(1)}${/[.!?]$/.test(r) ? "" : "."}`;
}

// One sentence on why a note ended up where it is
export function explain(note: {
  category?: string;
  gate_source?: string;
  gate_reason?: string;
  pii_hits?: string[];
}): string {
  const pii = note.pii_hits ?? [];
  switch (note.gate_source) {
    case "pending":
      return "Checking whether it's safe to share…";
    case "rule":
      return pii.length
        ? `It contains ${list(pii.map(piiLabel))}, so it was kept private automatically.`
        : "It matched a privacy rule, so it was kept private automatically.";
    case "fallback":
      // The AI was unavailable, so simple heuristics decided (private when unsure)
      return note.category === "private"
        ? "The AI was unavailable when you saved it, so it was kept private to be safe."
        : `${sentence(note.gate_reason)} The AI was unavailable, so simple rules decided.`.trim();
    case "user":
      return "You chose this.";
    case "user_approved":
      return "You approved sharing this fact from a private note.";
    case "llm":
      return sentence(note.gate_reason) || "Decided by the on-device AI.";
    default:
      return sentence(note.gate_reason);
  }
}

export function timeAgo(ts?: number | string | null) {
  if (!ts) return "never";
  const ms = Date.now() - Number(ts);
  if (!Number.isFinite(ms)) return "never";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(Number(ts)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// The edge returns FastAPI errors as JSON text: {"detail": "..."}
export function errorDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    return JSON.parse(msg).detail ?? msg;
  } catch {
    return msg;
  }
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
