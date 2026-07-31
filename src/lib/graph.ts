import type { ScrolledPoint } from './qdrant';
import type { GraphData, GraphEdge, GraphNode } from './types';

/** Cosine similarity. Gemini's truncated embeddings are not unit-length. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const entityId = (name: string, type: string) =>
  `entity:${type}:${name.trim().toLowerCase().replace(/\s+/g, '-')}`;

/**
 * Semantic edges are capped per note. Without a cap, every note links to every
 * other one above the threshold and the graph collapses into a hairball.
 */
const SIMILARITY_THRESHOLD = 0.55;
const MAX_SIMILAR_PER_NOTE = 3;

export function buildGraph(points: ScrolledPoint[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // --- note nodes + entity nodes + "mentions" edges ---
  for (const p of points) {
    const note = p.payload;
    nodes.set(p.id, {
      id: p.id,
      kind: 'note',
      label: note.title || note.text.slice(0, 40),
      variant: note.sentiment || 'neutral',
      degree: 0,
      createdAt: note.createdAt,
      summary: note.summary,
    });

    const seen = new Set<string>();
    for (const e of note.entities || []) {
      const id = entityId(e.name, e.type);
      if (seen.has(id)) continue;
      seen.add(id);

      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: 'entity',
          label: e.name,
          variant: e.type,
          degree: 0,
        });
      }
      edges.push({ source: p.id, target: id, kind: 'mentions', weight: 1 });
    }
  }

  // --- semantic note<->note edges ---
  const vectored = points.filter((p) => Array.isArray(p.vector) && p.vector.length > 0);
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const added = new Set<string>();

  for (const a of vectored) {
    const scored: Array<{ id: string; score: number }> = [];
    for (const b of vectored) {
      if (a.id === b.id) continue;
      const score = cosine(a.vector!, b.vector!);
      if (score >= SIMILARITY_THRESHOLD) scored.push({ id: b.id, score });
    }
    scored.sort((x, y) => y.score - x.score);

    for (const { id, score } of scored.slice(0, MAX_SIMILAR_PER_NOTE)) {
      const key = pairKey(a.id, id);
      if (added.has(key)) continue;
      added.add(key);
      edges.push({ source: a.id, target: id, kind: 'similar', weight: score });
    }
  }

  // --- degrees drive node radius in the renderer ---
  for (const e of edges) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (s) s.degree++;
    if (t) t.degree++;
  }

  const noteCount = points.length;
  const entityCount = [...nodes.values()].filter((n) => n.kind === 'entity').length;
  const possible = (nodes.size * (nodes.size - 1)) / 2;

  return {
    nodes: [...nodes.values()],
    edges,
    stats: {
      notes: noteCount,
      entities: entityCount,
      connections: edges.length,
      density: possible > 0 ? edges.length / possible : 0,
    },
  };
}

/**
 * Given seed note ids, returns those notes plus anything one hop away through a
 * shared entity. This is what makes the answers feel like they came from a
 * graph rather than from a flat top-k search.
 */
export function expandOneHop(points: ScrolledPoint[], seedIds: string[]): ScrolledPoint[] {
  const seeds = new Set(seedIds);
  const seedEntities = new Set<string>();

  for (const p of points) {
    if (!seeds.has(p.id)) continue;
    for (const e of p.payload.entities || []) seedEntities.add(entityId(e.name, e.type));
  }

  const result: ScrolledPoint[] = [];
  for (const p of points) {
    if (seeds.has(p.id)) {
      result.push(p);
      continue;
    }
    const hit = (p.payload.entities || []).some((e) => seedEntities.has(entityId(e.name, e.type)));
    if (hit) result.push(p);
  }
  return result;
}
