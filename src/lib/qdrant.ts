import { getEnv } from './env';
import { VECTOR_SIZE } from './gemini';
import type { Note } from './types';

export const COLLECTION = 'synapse_notes';

async function qdrant(path: string, init: RequestInit = {}) {
  const { QDRANT_URL, QDRANT_API_KEY } = getEnv();
  const res = await fetch(`${QDRANT_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'api-key': QDRANT_API_KEY,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  return res;
}

let ensured = false;

/**
 * Creates the collection on first use. Also indexes the fields we filter on —
 * without a payload index Qdrant rejects filtered scrolls on large collections.
 */
export async function ensureCollection() {
  if (ensured) return;

  const check = await qdrant(`/collections/${COLLECTION}`);
  if (check.status !== 200) {
    const create = await qdrant(`/collections/${COLLECTION}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
      }),
    });
    if (!create.ok && create.status !== 409) {
      throw new Error(`Qdrant collection create failed: ${await create.text()}`);
    }
  }
  ensured = true;
}

export async function upsertNote(note: Note, vector: number[]) {
  await ensureCollection();
  const { id, ...payload } = note;
  const res = await qdrant(`/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points: [{ id, vector, payload }] }),
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);
}

/** Patches payload fields without touching the vector — no re-embedding cost. */
export async function setPayload(id: string, payload: Record<string, unknown>) {
  await ensureCollection();
  const res = await qdrant(`/collections/${COLLECTION}/points/payload?wait=true`, {
    method: 'POST',
    body: JSON.stringify({ payload, points: [id] }),
  });
  if (!res.ok) throw new Error(`Qdrant set_payload failed: ${await res.text()}`);
}

export async function deleteNote(id: string) {
  await ensureCollection();
  const res = await qdrant(`/collections/${COLLECTION}/points/delete?wait=true`, {
    method: 'POST',
    body: JSON.stringify({ points: [id] }),
  });
  if (!res.ok) throw new Error(`Qdrant delete failed: ${await res.text()}`);
}

export interface ScrolledPoint {
  id: string;
  payload: Omit<Note, 'id'>;
  vector?: number[];
}

/** Pulls every note. Fine at prototype scale; page through if this ever grows. */
export async function scrollNotes(withVectors = false): Promise<ScrolledPoint[]> {
  await ensureCollection();
  const out: ScrolledPoint[] = [];
  let offset: unknown = undefined;

  for (let page = 0; page < 20; page++) {
    const res = await qdrant(`/collections/${COLLECTION}/points/scroll`, {
      method: 'POST',
      body: JSON.stringify({
        limit: 256,
        with_payload: true,
        with_vector: withVectors,
        ...(offset ? { offset } : {}),
      }),
    });
    if (!res.ok) {
      if (res.status === 404) return out;
      throw new Error(`Qdrant scroll failed: ${await res.text()}`);
    }
    const data = await res.json();
    for (const p of data.result?.points ?? []) {
      out.push({ id: String(p.id), payload: p.payload, vector: p.vector });
    }
    offset = data.result?.next_page_offset;
    if (!offset) break;
  }
  return out;
}

export interface SearchHit {
  id: string;
  score: number;
  payload: Omit<Note, 'id'>;
}

export async function searchNotes(vector: number[], limit = 6): Promise<SearchHit[]> {
  await ensureCollection();
  const res = await qdrant(`/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    body: JSON.stringify({ vector, limit, with_payload: true }),
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Qdrant search failed: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.result ?? []).map((h: { id: string | number; score: number; payload: Omit<Note, 'id'> }) => ({
    id: String(h.id),
    score: h.score,
    payload: h.payload,
  }));
}
