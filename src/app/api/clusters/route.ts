import { NextResponse } from 'next/server';
import { CLUSTER_COLORS, detectCommunities, type Cluster } from '@/lib/cluster';
import { buildGraph } from '@/lib/graph';
import { generateJson } from '@/lib/gemini';
import { scrollNotes } from '@/lib/qdrant';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Naming costs a Gemini call, so cache per user until their notes change. */
const cache = new Map<string, { key: string; clusters: Cluster[] }>();

const NAME_SCHEMA = {
  type: 'OBJECT',
  properties: {
    names: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          name: { type: 'STRING' },
        },
        required: ['index', 'name'],
      },
    },
  },
  required: ['names'],
};

export async function GET() {
  try {
    const user = await requireUser();
    const points = await scrollNotes(user.id, true);
    const graph = buildGraph(points);

    const key = points
      .map((p) => p.id)
      .sort()
      .join(',');
    const hit = cache.get(user.id);
    if (hit?.key === key) return NextResponse.json({ clusters: hit.clusters });

    const membership = detectCommunities(graph);
    const byCluster = new Map<number, string[]>();
    for (const [nodeId, c] of membership) {
      if (!byCluster.has(c)) byCluster.set(c, []);
      byCluster.get(c)!.push(nodeId);
    }

    if (byCluster.size === 0) {
      cache.set(user.id, { key, clusters: [] });
      return NextResponse.json({ clusters: [] });
    }

    const noteIds = new Set(points.map((p) => p.id));
    const nodeLabel = new Map(graph.nodes.map((n) => [n.id, n.label]));

    const draft = [...byCluster.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, nodeIds_]) => ({
        id,
        nodeIds: nodeIds_,
        noteIds: nodeIds_.filter((n) => noteIds.has(n)),
        labels: nodeIds_.map((n) => nodeLabel.get(n) ?? '').filter(Boolean),
      }));

    // One call names every cluster — cheaper and more consistent than N calls.
    const prompt = `You are naming the themes in someone's personal knowledge graph.
For each group below, give a short, evocative 2-4 word theme name that captures what
ties those items together. Write it like a chapter title, not a category label.
Avoid generic words like "Notes", "Misc", "General", "Various".

${draft.map((d, i) => `Group ${i}:\n${d.labels.slice(0, 18).join(', ')}`).join('\n\n')}`;

    let names: Array<{ index: number; name: string }> = [];
    try {
      const data = await generateJson(prompt, NAME_SCHEMA);
      names = data.names ?? [];
    } catch {
      // Naming is a nicety — never let it break the graph.
      names = [];
    }

    const nameByIndex = new Map(names.map((n) => [n.index, n.name]));
    const clusters: Cluster[] = draft.map((d, i) => ({
      id: d.id,
      name: nameByIndex.get(i)?.trim() || `Theme ${i + 1}`,
      nodeIds: d.nodeIds,
      noteIds: d.noteIds,
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
    }));

    cache.set(user.id, { key, clusters });
    return NextResponse.json({ clusters });
  } catch (err) {
    return fail(err);
  }
}
