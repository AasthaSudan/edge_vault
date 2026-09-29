export type AskEvent =
  | { type: "sources"; session_id: string; sources: Source[]; retrieve_ms: number }
  | { type: "token"; text: string }
  | {
      type: "done";
      message_id: string;
      cited_ns: number[];
      cited: string[];
      grounded: boolean;
      latency_ms: { retrieve: number; first_token: number | null; total: number };
    };

export type Source = {
  n: number;
  memory_id: string;
  category: "shareable" | "private" | "routine";
  title?: string;
  asset_tag?: string;
  text?: string;
  origin: string;
  score?: number;
};

export async function* askStream(
  base: string,
  body: { question: string; session_id?: string; scope?: string }
): AsyncGenerator<AskEvent, void, unknown> {
  const res = await fetch(`${base}/assistant/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ask stream request failed with status: ${res.status}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          yield JSON.parse(line) as AskEvent;
        } catch {
          // Ignore json parse error on corrupted chunks
        }
      }
    }
  }
}
