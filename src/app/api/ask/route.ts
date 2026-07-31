import { NextResponse } from 'next/server';
import { embed, streamAnswer } from '@/lib/gemini';
import { expandOneHop, } from '@/lib/graph';
import { scrollNotes, searchNotes } from '@/lib/qdrant';
import { ASK_DELIMITER as DELIMITER } from '@/lib/protocol';
import type { Citation } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM = `You are Synapse, the user's second brain. You answer using ONLY the
notes provided below — these are the user's own recorded thoughts.

Rules:
- Answer in the second person ("you mentioned", "you were worried about").
- Be direct and specific. Lead with the answer, not with preamble.
- Cite notes inline using their bracket number, like [1] or [2][3].
- If the notes genuinely do not contain the answer, say so plainly and mention
  what related things you DO have. Never invent details.
- Surface connections between notes when they exist — that is the whole point of
  a knowledge graph. If two notes relate, say how.
- Keep it under 200 words unless the question demands more. Markdown is fine.`;

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'query (string) is required' }, { status: 400 });
    }

    const vector = await embed(query.trim(), 'RETRIEVAL_QUERY');
    const hits = await searchNotes(vector, 6);

    if (hits.length === 0) {
      const empty = new TextEncoder().encode(
        JSON.stringify({ citations: [] }) +
          DELIMITER +
          "Your graph is empty — record a note first and I'll have something to reason over."
      );
      return new Response(empty, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // Graph expansion: pull in notes sharing an entity with the top hits, so the
    // model can reason across connections the raw vector search would miss.
    const all = await scrollNotes(false);
    const expanded = expandOneHop(all, hits.slice(0, 3).map((h) => h.id));

    const scoreById = new Map(hits.map((h) => [h.id, h.score]));
    const ordered = [
      ...hits.map((h) => ({ id: h.id, payload: h.payload })),
      ...expanded.filter((p) => !scoreById.has(p.id)).slice(0, 4),
    ];

    const citations: Citation[] = ordered.map((p) => ({
      id: p.id,
      title: p.payload.title || p.payload.text.slice(0, 40),
      score: scoreById.get(p.id) ?? 0,
    }));

    const context = ordered
      .map((p, i) => {
        const n = p.payload;
        return [
          `[${i + 1}] ${n.title}`,
          `date: ${new Date(n.createdAt).toDateString()}`,
          n.entities?.length ? `entities: ${n.entities.map((e) => e.name).join(', ')}` : '',
          n.actionItems?.length ? `action items: ${n.actionItems.join('; ')}` : '',
          `note: ${n.text}`,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n---\n\n');

    const prompt = `${SYSTEM}\n\n=== THE USER'S NOTES ===\n\n${context}\n\n=== QUESTION ===\n\n${query.trim()}`;

    const answerStream = await streamAnswer(prompt);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ citations }) + DELIMITER));
        const reader = answerStream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`\n\n_Stream error: ${(err as Error).message}_`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
