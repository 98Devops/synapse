import { buildGraph } from '@/lib/graph';
import { scrollNotes } from '@/lib/qdrant';
import { requireUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** GET /api/export?format=json|md — the whole brain, portable. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const format = new URL(req.url).searchParams.get('format') ?? 'json';
    const points = await scrollNotes(user.id, true);
    const notes = points
      .map((p) => ({ id: p.id, ...p.payload }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'md') {
      const md = [
        `# Synapse export — ${stamp}`,
        '',
        `${notes.length} notes.`,
        '',
        ...notes.flatMap((n) => {
          const done = new Set(n.completedActions ?? []);
          return [
            `## ${n.title}`,
            '',
            `*${new Date(n.createdAt).toLocaleString()} · ${n.sentiment} · via ${n.source}*`,
            '',
            n.summary,
            '',
            n.entities?.length
              ? `**Entities:** ${n.entities.map((e) => `${e.name} (${e.type})`).join(', ')}`
              : '',
            n.tags?.length ? `**Tags:** ${n.tags.map((t) => `#${t}`).join(' ')}` : '',
            '',
            ...(n.actionItems?.length
              ? ['**Actions:**', ...n.actionItems.map((a) => `- [${done.has(a) ? 'x' : ' '}] ${a}`), '']
              : []),
            '> ' + n.text.replace(/\n/g, '\n> '),
            '',
            '---',
            '',
          ].filter((l) => l !== '');
        }),
      ].join('\n');

      return new Response(md, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="synapse-${stamp}.md"`,
        },
      });
    }

    const body = JSON.stringify(
      { exportedAt: new Date().toISOString(), notes, graph: buildGraph(points) },
      null,
      2
    );
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="synapse-${stamp}.json"`,
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
