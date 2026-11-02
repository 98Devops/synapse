/**
 * Rebuilds the Qdrant index from Postgres.
 *
 * Postgres is the source of truth; Qdrant is derived. Run this after pointing
 * QDRANT_URL at a new (or wiped) cluster. Indexes each note and its facets
 * exactly as capture does. Facet ids are derived from the note id, so reruns
 * overwrite rather than duplicate.
 *
 *   node scripts/reindex.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const COLLECTION = 'synapse_notes';
const EMBED_MODEL = 'gemini-embedding-001';
const VECTOR_SIZE = 768;

const qdrantUrl = (() => {
  const u = new URL(env.QDRANT_URL);
  if (!u.port) u.port = '6333';
  return u.origin;
})();

const sb = (path) =>
  fetch(`${SUPA}${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });

const qd = (path, init = {}) =>
  fetch(`${qdrantUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'api-key': env.QDRANT_API_KEY, ...(init.headers || {}) },
  });

/** Deterministic UUID so a rerun upserts the same facet point. */
const stableId = (...parts) => {
  const h = crypto.createHash('sha1').update(parts.join(':')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function embedBatch(texts) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: VECTOR_SIZE,
          })),
        }),
      }
    );
    if (res.ok) return (await res.json()).embeddings.map((e) => e.values);
    if (res.status !== 429 && res.status < 500) throw new Error(`embed: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw new Error('embed: gave up after retries');
}

// ---------------------------------------------------------------- collection
const check = await qd(`/collections/${COLLECTION}`);
if (check.status !== 200) {
  const create = await qd(`/collections/${COLLECTION}`, {
    method: 'PUT',
    body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: 'Cosine' } }),
  });
  if (!create.ok && create.status !== 409) {
    console.error('Could not create collection:', await create.text());
    process.exit(1);
  }
  console.log(`Created collection ${COLLECTION}`);
}
for (const field of ['userId', 'kind', 'intent', 'spaceId', 'parentId']) {
  await qd(`/collections/${COLLECTION}/index?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
  });
}

// ---------------------------------------------------------------- notes
const select = [
  'id,user_id,title,text,summary,sentiment,tags,source,created_at,intent,space_id',
  'actions(text)',
  'decisions(text)',
  'questions!questions_note_id_fkey(text)',
  'note_entities(entities(name,type))',
].join(',');
const notesRes = await sb(`/rest/v1/notes?select=${encodeURIComponent(select)}&order=created_at.asc`);
if (!notesRes.ok) {
  console.error('Could not read notes:', await notesRes.text());
  process.exit(1);
}
const notes = await notesRes.json();
console.log(`Reindexing ${notes.length} notes…`);

let total = 0;
for (const n of notes) {
  const actions = (n.actions ?? []).map((a) => a.text);
  const targets = [
    { kind: 'note', text: `${n.title}\n${n.text}`, label: n.title },
    ...actions.map((t) => ({ kind: 'action', text: t, label: t })),
    ...(n.decisions ?? []).map((d) => ({ kind: 'decision', text: d.text, label: d.text })),
    ...(n.questions ?? []).map((q) => ({ kind: 'question', text: q.text, label: q.text })),
  ];

  const vectors = await embedBatch(targets.map((t) => t.text));

  const points = targets.map((t, i) => ({
    id: t.kind === 'note' ? n.id : stableId(n.id, t.kind, i),
    vector: vectors[i],
    payload: {
      kind: t.kind,
      parentId: n.id,
      label: t.label,
      title: n.title,
      text: t.kind === 'note' ? n.text : t.text,
      summary: n.summary,
      sentiment: n.sentiment,
      intent: n.intent,
      spaceId: n.space_id ?? '',
      tags: n.tags ?? [],
      entities: (n.note_entities ?? []).map((ne) => ne.entities).filter(Boolean),
      actionItems: actions,
      createdAt: n.created_at,
      source: n.source,
      userId: n.user_id,
    },
  }));

  const up = await qd(`/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points }),
  });
  if (!up.ok) {
    console.error(`  ✗ ${n.title}: ${await up.text()}`);
    continue;
  }
  total += points.length;
  console.log(`  ✓ ${n.title} (${points.length} points)`);
}

console.log(`Done. ${total} points indexed.`);
