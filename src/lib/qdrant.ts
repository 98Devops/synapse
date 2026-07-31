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
 * Creates the collection on first use, plus a payload index on userId — every
 * query filters by it, and Qdrant needs the index for that to stay fast.
 */
export async function ensureCollection() {
  if (ensured) return;

  const check = await qdrant(`/collections/${COLLECTION}`);
  if (check.status !== 200) {
    const create = await qdrant(`/collections/${COLLECTION}`, {
      method: 'PUT',
      body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: 'Cosine' } }),
    });
    if (!create.ok && create.status !== 409) {
      throw new Error(`Qdrant collection create failed: ${await create.text()}`);
    }
  }

  // Payload indexes let Qdrant narrow the candidate set *before* the ANN search,
  // which is what makes "decisions about Atlas since June" fast rather than a
  // full scan followed by filtering. Idempotent — conflicts are ignored.
  for (const field of ['userId', 'kind', 'intent', 'spaceId', 'parentId']) {
    await qdrant(`/collections/${COLLECTION}/index?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
    }).catch(() => {});
  }

  ensured = true;
}

/** Anything indexed: a whole note, or one facet pointing back at its note. */
export type PointKind = 'note' | 'action' | 'decision' | 'question' | 'datapoint';

export interface IndexPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown> & { kind: PointKind; parentId: string };
}

export async function upsertPoints(points: IndexPoint[], userId: string) {
  if (points.length === 0) return;
  await ensureCollection();
  const res = await qdrant(`/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: { ...p.payload, userId },
      })),
    }),
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);
}

/** Removes a note and every facet point derived from it. */
export async function deleteNoteTree(noteId: string, userId: string) {
  await ensureCollection();
  const res = await qdrant(`/collections/${COLLECTION}/points/delete?wait=true`, {
    method: 'POST',
    body: JSON.stringify({
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
        should: [
          { has_id: [noteId] },
          { key: 'parentId', match: { value: noteId } },
        ],
        min_should: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Qdrant delete failed: ${await res.text()}`);
}

/** Every read is scoped to one user. This is the isolation boundary. */
const ownerFilter = (userId: string) => ({
  must: [{ key: 'userId', match: { value: userId } }],
});

export async function upsertNote(note: Note, vector: number[], userId: string) {
  await ensureCollection();
  const { id, ...rest } = note;
  const res = await qdrant(`/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points: [{ id, vector, payload: { ...rest, userId } }] }),
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

export async function scrollNotes(userId: string, withVectors = false): Promise<ScrolledPoint[]> {
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
        filter: ownerFilter(userId),
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

export interface SearchOptions {
  /** Restrict to certain point kinds, e.g. only decisions. */
  kinds?: PointKind[];
  intent?: string;
  spaceId?: string;
}

export async function searchNotes(
  vector: number[],
  userId: string,
  limit = 6,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  await ensureCollection();

  const must: Array<Record<string, unknown>> = [
    { key: 'userId', match: { value: userId } },
  ];
  if (opts.kinds?.length) must.push({ key: 'kind', match: { any: opts.kinds } });
  if (opts.intent) must.push({ key: 'intent', match: { value: opts.intent } });
  if (opts.spaceId) must.push({ key: 'spaceId', match: { value: opts.spaceId } });

  const res = await qdrant(`/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    body: JSON.stringify({ vector, limit, with_payload: true, filter: { must } }),
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Qdrant search failed: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.result ?? []).map(
    (h: { id: string | number; score: number; payload: Omit<Note, 'id'> }) => ({
      id: String(h.id),
      score: h.score,
      payload: h.payload,
    })
  );
}

/** Used once, by the migration, to adopt pre-auth notes into an account. */
export async function claimOrphanNotes(userId: string): Promise<number> {
  await ensureCollection();
  const res = await qdrant(`/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    body: JSON.stringify({
      limit: 256,
      with_payload: true,
      filter: { must_not: [{ key: 'userId', match: { value: userId } }] },
    }),
  });
  if (!res.ok) return 0;

  const data = await res.json();
  const orphans = (data.result?.points ?? []).filter(
    (p: { payload?: { userId?: string } }) => !p.payload?.userId
  );
  if (orphans.length === 0) return 0;

  const claim = await qdrant(`/collections/${COLLECTION}/points/payload?wait=true`, {
    method: 'POST',
    body: JSON.stringify({
      payload: { userId },
      points: orphans.map((p: { id: string | number }) => p.id),
    }),
  });
  if (!claim.ok) throw new Error(`Qdrant claim failed: ${await claim.text()}`);
  return orphans.length;
}
