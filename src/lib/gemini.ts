import { getEnv } from './env';
import type { Extraction } from './types';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export const EMBED_MODEL = 'gemini-embedding-001';
export const CHAT_MODEL = 'gemini-3.6-flash';
/**
 * Free-tier quota is per-model and low (~5 rpm). When the primary is rate
 * limited we fall down this chain rather than failing the user's capture.
 */
const CHAT_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-2.0-flash', 'gemini-flash-lite-latest'];
/** Truncated from the model's native 3072. Must match the Qdrant collection size. */
export const VECTOR_SIZE = 768;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 = quota, 503 = model overloaded. Both are worth retrying. */
const isTransient = (status: number) => status === 429 || status === 503 || status >= 500;

async function geminiFetch(path: string, body: unknown, attempts = 3) {
  const { GEMINI_API_KEY } = getEnv();
  let lastErr = '';

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${API}/${path}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    lastErr = (await res.text()).slice(0, 400);
    if (!isTransient(res.status) || i === attempts - 1) {
      const err = new Error(`Gemini ${path} failed (${res.status}): ${lastErr}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    // 1s, 3s, 7s — enough to clear a per-minute burst limit.
    await sleep(1000 * (2 ** i * 2 - 1));
  }
  throw new Error(`Gemini ${path} failed: ${lastErr}`);
}

/** Tries the primary chat model, then each fallback, on quota/overload errors. */
async function generate(body: unknown) {
  const chain = [CHAT_MODEL, ...CHAT_FALLBACKS];
  let lastErr: Error | null = null;

  for (const model of chain) {
    try {
      return await geminiFetch(`${model}:generateContent`, body, 2);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      lastErr = err as Error;
      if (status && !isTransient(status)) throw err;
    }
  }
  throw lastErr ?? new Error('All Gemini chat models failed');
}

/**
 * Task type matters: RETRIEVAL_DOCUMENT when storing, RETRIEVAL_QUERY when
 * searching. Using the same one for both measurably degrades match quality.
 */
export async function embed(
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT'
): Promise<number[]> {
  const data = await geminiFetch(`${EMBED_MODEL}:embedContent`, {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: VECTOR_SIZE,
  });
  return data.embedding.values as number[];
}

/** Generic structured-output helper for anything that isn't note extraction. */
export async function generateJson(prompt: string, schema: unknown): Promise<any> {
  const data = await generate({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.5,
    },
  });
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned no JSON content');
  return JSON.parse(raw);
}

const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'A short, specific 2-6 word title.' },
    summary: { type: 'STRING', description: 'One or two sentences, third person.' },
    sentiment: { type: 'STRING', enum: ['positive', 'neutral', 'negative', 'urgent'] },
    tags: { type: 'ARRAY', items: { type: 'STRING' }, description: '2-5 broad topic tags.' },
    actionItems: { type: 'ARRAY', items: { type: 'STRING' } },
    entities: {
      type: 'ARRAY',
      description: 'Concrete named things worth linking notes by.',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          type: { type: 'STRING', enum: ['person', 'project', 'org', 'concept', 'place', 'tool'] },
        },
        required: ['name', 'type'],
      },
    },
  },
  required: ['title', 'summary', 'sentiment', 'tags', 'actionItems', 'entities'],
};

const EXTRACT_PROMPT = `You are the indexing engine of a personal knowledge graph.
Extract structure from the raw voice note below.

Rules:
- Entities are the graph's connective tissue. Extract the specific named things
  (people, projects, organisations, tools, places, concepts) that would plausibly
  recur across other notes. Normalise them: "Sarah" not "sarah at acme", "Qdrant"
  not "the qdrant db".
- Do NOT invent entities that are not clearly present.
- Prefer 3-8 entities. Fewer is fine for a short note.
- Action items only if the speaker committed to something.
- The note is a raw speech transcript: it may lack punctuation and contain
  transcription errors. Interpret generously.

Raw note:
"""
{{TEXT}}
"""`;

export async function extract(text: string): Promise<Extraction> {
  const data = await generate({
    contents: [{ role: 'user', parts: [{ text: EXTRACT_PROMPT.replace('{{TEXT}}', text) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA,
      temperature: 0.2,
    },
  });

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned no extraction content');

  const parsed = JSON.parse(raw) as Extraction;

  // Defensive: the model is schema-constrained, but never trust it fully.
  return {
    title: parsed.title?.trim() || text.slice(0, 40),
    summary: parsed.summary?.trim() || '',
    sentiment: parsed.sentiment || 'neutral',
    tags: (parsed.tags || []).filter(Boolean).slice(0, 8),
    actionItems: (parsed.actionItems || []).filter(Boolean),
    entities: (parsed.entities || [])
      .filter((e) => e?.name?.trim())
      .map((e) => ({ name: e.name.trim(), type: e.type }))
      .slice(0, 12),
  };
}

/** Streams the answer back as plain text chunks via SSE from Gemini. */
export async function streamAnswer(prompt: string): Promise<ReadableStream<Uint8Array>> {
  const { GEMINI_API_KEY } = getEnv();
  let res: Response | null = null;
  let lastErr = '';

  // Same fallback chain as generate() — a rate-limited primary shouldn't kill a question.
  for (const model of [CHAT_MODEL, ...CHAT_FALLBACKS]) {
    const attempt = await fetch(
      `${API}/${model}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4 },
        }),
      }
    );
    if (attempt.ok && attempt.body) {
      res = attempt;
      break;
    }
    lastErr = `(${attempt.status}) ${(await attempt.text()).slice(0, 200)}`;
    if (!isTransient(attempt.status)) break;
  }

  if (!res || !res.body) {
    throw new Error(`Gemini stream failed ${lastErr}`);
  }

  // Unwrap Gemini's SSE envelope into a bare text stream the client can append.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return res.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) controller.enqueue(encoder.encode(text));
          } catch {
            // partial JSON across chunk boundary — safe to skip
          }
        }
      },
    })
  );
}
