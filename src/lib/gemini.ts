import { getEnv } from './env';
import type { Extraction } from './types';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export const EMBED_MODEL = 'gemini-embedding-001';
/**
 * flash-lite is ~4x faster than 3.6-flash (1.4s vs 6s measured) and produced
 * identical entity extraction on our test notes. Latency matters more than
 * headroom here, so it leads and the bigger model is the fallback.
 */
export const CHAT_MODEL = 'gemini-3.1-flash-lite';
/**
 * Free-tier quota is per-model and low (~5 rpm). When the primary is rate
 * limited we fall down this chain rather than failing the user's capture.
 */
const CHAT_FALLBACKS = ['gemini-3.6-flash', 'gemini-2.0-flash', 'gemini-flash-lite-latest'];
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

/**
 * One request for many texts. Indexing a note plus its facets is 3-6 embeddings;
 * doing them serially would undo the capture-latency work.
 */
export async function embedBatch(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const data = await geminiFetch(`${EMBED_MODEL}:batchEmbedContents`, {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: VECTOR_SIZE,
    })),
  });

  return (data.embeddings ?? []).map((e: { values: number[] }) => e.values);
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

    intent: {
      type: 'STRING',
      enum: [
        'task', 'decision', 'idea', 'question', 'observation',
        'reflection', 'reference', 'log', 'unclassified',
      ],
      description: 'The single dominant thing the speaker was doing.',
    },
    intentConfidence: {
      type: 'NUMBER',
      description: '0..1. Be honest — below 0.6 sends the note for human review.',
    },
    unclassifiedReason: {
      type: 'STRING',
      description: 'Only when intent is unclassified or confidence is low. One short phrase.',
    },
    suggestedSpace: {
      type: 'STRING',
      description:
        'The durable area of life/work this belongs to, e.g. "Project Atlas" or "Interview prep". Empty if unclear.',
    },

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
    actions: {
      type: 'ARRAY',
      description: 'Only genuine commitments the speaker made.',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          owner: { type: 'STRING', description: 'Who owes it, if stated. Empty means the speaker.' },
          dueDate: { type: 'STRING', description: 'ISO date if a date is stated or clearly implied.' },
          priority: { type: 'STRING', enum: ['low', 'normal', 'high'] },
        },
        required: ['text'],
      },
    },
    dataPoints: {
      type: 'ARRAY',
      description: 'Hard facts worth keeping: numbers, dates, metrics, identifiers.',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'STRING' },
          unit: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['metric', 'date', 'money', 'identifier', 'fact'] },
        },
        required: ['label', 'value', 'kind'],
      },
    },
    questions: {
      type: 'ARRAY',
      description: 'Things raised but left unresolved.',
      items: { type: 'STRING' },
    },
    decisions: {
      type: 'ARRAY',
      description: 'Choices the speaker settled on.',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['text'],
      },
    },
  },
  required: [
    'title', 'summary', 'sentiment', 'tags', 'intent', 'intentConfidence',
    'entities', 'actions', 'dataPoints', 'questions', 'decisions',
  ],
};

const EXTRACT_PROMPT = `You are the indexing engine of a personal knowledge graph.
Classify and extract structure from the raw voice note below.

INTENT — pick the single dominant one:
- task: committing to do something
- decision: recording a choice already made
- idea: proposing something new, exploratory
- question: raising something unresolved
- observation: noting a fact about the world
- reflection: processing their own state or feelings
- reference: capturing external material (a link, quote, figure)
- log: routine record of what happened
- unclassified: too short, pure filler, or genuinely ambiguous

Set intentConfidence honestly. Use below 0.6 when the note is thin, rambling, or
carries two intents with no dominant one — that routes it to human review, which is
far better than filing it wrongly. For filler like "testing testing" or "hmm okay",
use intent=unclassified with a short unclassifiedReason.

FACETS — a note can carry several, independent of its intent. A "log" note can
still contain an action and a data point; extract them all.
- actions: only genuine commitments, not vague intentions
- dataPoints: concrete numbers, dates, money, identifiers, hard facts
- questions: only things left genuinely open
- decisions: only settled choices

ENTITIES are the graph's connective tissue. Extract the specific named things that
would plausibly recur in other notes. Normalise them: "Sarah" not "sarah from
acme", "Qdrant" not "the qdrant db". Never invent one that isn't clearly present.
Prefer 3-8; fewer is fine for a short note.

The note is a raw speech transcript: it may lack punctuation and contain
transcription errors. Interpret generously, but never fabricate.

Today is {{TODAY}}. Resolve relative dates ("Thursday", "next week") against it,
and never emit a date in a different year unless the speaker said so.
{{LEARNED}}
Raw note:
"""
{{TEXT}}
"""`;

/**
 * Past user corrections become few-shot examples, so the extractor adapts to how
 * this particular person talks. See docs/CLASSIFICATION.md ("Self-learning").
 */
export interface LearnedExample {
  excerpt: string;
  field: string;
  to: string;
}

function learnedBlock(examples: LearnedExample[]): string {
  if (!examples.length) return '\n';
  const lines = examples
    .slice(0, 8)
    .map((e) => `- "${e.excerpt.slice(0, 90)}" → ${e.field}: ${e.to}`)
    .join('\n');
  return `\nThis user has previously corrected your classifications. Follow these:\n${lines}\n`;
}

export async function extract(text: string, learned: LearnedExample[] = []): Promise<Extraction> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = EXTRACT_PROMPT.replace('{{TEXT}}', text)
    .replace('{{TODAY}}', `${today} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })})`)
    .replace('{{LEARNED}}', learnedBlock(learned));

  const data = await generate({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA,
      temperature: 0.2,
    },
  });

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned no extraction content');

  const p = JSON.parse(raw) as Partial<Extraction>;

  // The model is schema-constrained, but never trust it fully.
  const confidence = Math.max(0, Math.min(1, Number(p.intentConfidence ?? 0)));

  return {
    title: p.title?.trim() || text.slice(0, 40),
    summary: p.summary?.trim() || '',
    sentiment: p.sentiment || 'neutral',
    tags: (p.tags || []).filter(Boolean).slice(0, 8),

    intent: p.intent || 'unclassified',
    intentConfidence: confidence,
    unclassifiedReason: p.unclassifiedReason?.trim() || undefined,
    suggestedSpace: p.suggestedSpace?.trim() || undefined,

    entities: (p.entities || [])
      .filter((e) => e?.name?.trim())
      .map((e) => ({ name: e.name.trim(), type: e.type }))
      .slice(0, 12),
    actions: (p.actions || [])
      .filter((a) => a?.text?.trim())
      .map((a) => ({
        text: a.text.trim(),
        owner: a.owner?.trim() || undefined,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate ?? '') ? a.dueDate : undefined,
        priority: a.priority ?? 'normal',
      })),
    dataPoints: (p.dataPoints || [])
      .filter((d) => d?.label?.trim() && d?.value?.trim())
      .map((d) => ({
        label: d.label.trim(),
        value: d.value.trim(),
        unit: d.unit?.trim() || undefined,
        kind: d.kind ?? 'fact',
      })),
    questions: (p.questions || []).filter((q) => q?.trim()).map((q) => q.trim()),
    decisions: (p.decisions || [])
      .filter((d) => d?.text?.trim())
      .map((d) => ({ text: d.text.trim(), alternatives: (d.alternatives || []).filter(Boolean) })),
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
