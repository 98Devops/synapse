import type { GraphData } from './types';

export interface Cluster {
  id: number;
  name: string;
  nodeIds: string[];
  noteIds: string[];
  color: string;
}

export const CLUSTER_COLORS = [
  '#6366f1',
  '#22d3ee',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#fb7185',
  '#38bdf8',
];

/**
 * Label propagation. Each node adopts the most common label among its
 * neighbours, weighted by edge strength, until things stop moving. Cheap,
 * deterministic enough with a seeded shuffle, and good enough for a few
 * hundred nodes — which is the scale this ever runs at.
 */
export function detectCommunities(graph: GraphData): Map<string, number> {
  const labels = new Map<string, number>();
  graph.nodes.forEach((n, i) => labels.set(n.id, i));

  const neighbours = new Map<string, Array<{ id: string; w: number }>>();
  for (const n of graph.nodes) neighbours.set(n.id, []);
  for (const e of graph.edges) {
    // Entity links are the strongest signal of "these belong together".
    const w = e.kind === 'mentions' ? 1.4 : e.weight;
    neighbours.get(e.source)?.push({ id: e.target, w });
    neighbours.get(e.target)?.push({ id: e.source, w });
  }

  // Deterministic pseudo-shuffle so the layout doesn't reshuffle every reload.
  const order = [...graph.nodes.map((n) => n.id)].sort((a, b) => (a < b ? -1 : 1));

  for (let pass = 0; pass < 12; pass++) {
    let changed = 0;
    for (const id of order) {
      const nbrs = neighbours.get(id) ?? [];
      if (nbrs.length === 0) continue;

      const tally = new Map<number, number>();
      for (const nb of nbrs) {
        const l = labels.get(nb.id)!;
        tally.set(l, (tally.get(l) ?? 0) + nb.w);
      }
      let best = labels.get(id)!;
      let bestScore = -1;
      for (const [l, score] of tally) {
        if (score > bestScore || (score === bestScore && l < best)) {
          best = l;
          bestScore = score;
        }
      }
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed++;
      }
    }
    if (changed === 0) break;
  }

  // Compact labels to 0..n, dropping communities too small to be meaningful.
  const groups = new Map<number, string[]>();
  for (const [id, l] of labels) {
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(id);
  }

  const kept = [...groups.entries()]
    .filter(([, ids]) => ids.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  const out = new Map<string, number>();
  kept.forEach(([, ids], i) => ids.forEach((id) => out.set(id, i)));
  return out;
}

/** Andrew's monotone chain convex hull — used to draw the cluster blobs. */
export function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
