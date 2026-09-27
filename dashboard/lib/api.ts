export const EDGE_API =
  process.env.NEXT_PUBLIC_EDGE_API || "http://localhost:7001";

export const CLOUD_API =
  process.env.NEXT_PUBLIC_CLOUD_API || "http://localhost:8080";

export async function fetchEdge(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${EDGE_API}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchCloud(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${CLOUD_API}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Error ${res.status}`);
  }
  return res.json();
}
