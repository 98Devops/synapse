import { NextResponse } from 'next/server';
import { embedBatch, extract } from '@/lib/gemini';
import { learnedCorrections, placeNote } from '@/lib/classify';
import { insertNote, listNotes } from '@/lib/db/notes';
import { searchNotes, upsertPoints, type IndexPoint } from '@/lib/qdrant';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';
import type { Note, NoteStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const status = new URL(req.url).searchParams.get('status') as NoteStatus | null;
    return NextResponse.json({ notes: await listNotes(user.id, status ?? undefined) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { text, source = 'voice', audioPath = null } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text (string) is required' }, { status: 400 });
    }

    const clean = text.trim();

    // Extraction is informed by past corrections, so it adapts to this user.
    const learned = await learnedCorrections(user.id);
    const extraction = await extract(clean, learned);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // --- index the note AND each facet separately -------------------------
    // A long note averages into a mushy vector; facet-level points mean a query
    // about a commitment matches the commitment, not the paragraph around it.
    const targets: Array<{ kind: IndexPoint['payload']['kind']; text: string; label: string }> = [
      { kind: 'note', text: `${extraction.title}\n${clean}`, label: extraction.title },
      ...extraction.actions.map((a) => ({ kind: 'action' as const, text: a.text, label: a.text })),
      ...extraction.decisions.map((d) => ({ kind: 'decision' as const, text: d.text, label: d.text })),
      ...extraction.questions.map((q) => ({ kind: 'question' as const, text: q, label: q })),
    ];

    const vectors = await embedBatch(
      targets.map((t) => t.text),
      'RETRIEVAL_DOCUMENT'
    );
    if (vectors.length !== targets.length) {
      throw new Error('Embedding count did not match the number of indexed items');
    }

    // Similar existing notes inform which thread this joins.
    const similar = await searchNotes(vectors[0], user.id, 5, { kinds: ['note'] });
    const similarIds = similar.filter((s) => s.score >= 0.7).map((s) => s.id);

    const placement = await placeNote(user.id, extraction, similarIds);

    const note: Note = {
      id,
      text: clean,
      createdAt,
      source: source === 'text' ? 'text' : 'voice',
      status: placement.status,
      spaceId: placement.spaceId,
      threadId: placement.threadId,
      audioPath,
      actionItems: extraction.actions.map((a) => a.text),
      ...extraction,
      unclassifiedReason: placement.reason ?? extraction.unclassifiedReason,
    };

    // Postgres first: if it rejects, nothing lands in the vector index either.
    await insertNote(user.id, note, placement, audioPath);

    const points: IndexPoint[] = targets.map((t, i) => ({
      // The note keeps its own id so citations resolve directly.
      id: t.kind === 'note' ? id : crypto.randomUUID(),
      vector: vectors[i],
      payload: {
        kind: t.kind,
        parentId: id,
        label: t.label,
        title: extraction.title,
        text: t.kind === 'note' ? clean : t.text,
        summary: extraction.summary,
        sentiment: extraction.sentiment,
        intent: extraction.intent,
        spaceId: placement.spaceId ?? '',
        tags: extraction.tags,
        entities: extraction.entities,
        actionItems: note.actionItems,
        createdAt,
        source: note.source,
      },
    }));
    await upsertPoints(points, user.id);

    return NextResponse.json({ note });
  } catch (err) {
    return fail(err);
  }
}
