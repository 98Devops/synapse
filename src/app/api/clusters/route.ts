import { NextResponse } from 'next/server';
import { CLUSTER_COLORS, detectCommunities, type Cluster } from '@/lib/cluster';
import { buildGraph } from '@/lib/graph';
import { generateJson } from '@/lib/gemini';
import { scrollNotes } from '@/lib/qdrant';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Naming costs a Gemini call, so cache until the note set actually changes. */
let cache: { key: string; clusters: Cluster[] } | null = null;

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
    const points = await scrollNotes(true);
    const graph = buildGraph(points);

    const key = points
      .map((p) => p.id)
      .sort()
      .join(',');
    if (cache?.key === key) return NextResponse.json({ clusters: cache.clusters });

    const membership = detectCommunities(graph);
    const byCluster = new Map<number, string[]>();
    for (const [nodeId, c] of membership) {
      if (!byCluster.has(c)) byCluster.set(c, []);
      byCluster.get(c)!.push(nodeId);
    }

    if (byCluster.size === 0) {
      cache = { key, clusters: [] };
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

    cache = { key, clusters };
    return NextResponse.json({ clusters });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
