// 127.0.0.1, not "localhost": the APIs listen on IPv4 loopback only, and on Windows
// "localhost" tries IPv6 (::1) first, which costs ~200-300 ms per new connection.
export const EDGE_API =
  process.env.NEXT_PUBLIC_EDGE_API || "http://127.0.0.1:7001";

export const CLOUD_API =
  process.env.NEXT_PUBLIC_CLOUD_API || "http://127.0.0.1:8080";

// Content-Type only when there is a body: a JSON header on a GET makes the browser send
// a CORS preflight (an extra round trip) before every new URL.
function withJsonHeader(options?: RequestInit): RequestInit | undefined {
  if (!options?.body) return options;
  return { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } };
}

export async function fetchEdge(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${EDGE_API}${endpoint}`, withJsonHeader(options));
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchCloud(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${CLOUD_API}${endpoint}`, withJsonHeader(options));
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Error ${res.status}`);
  }
  return res.json();
}

// The live event feed drives updates; polling is only a slow safety net for data that
// changes without an edge event (the local LLM's state, other devices' pushes).
export const POLL_MS = 30_000;
