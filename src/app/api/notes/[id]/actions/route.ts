import { NextResponse } from 'next/server';
import { scrollNotes, setPayload } from '@/lib/qdrant';

export const dynamic = 'force-dynamic';

/** Toggles a single action item complete/incomplete on a note. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { item, done } = await req.json();
    if (typeof item !== 'string') {
      return NextResponse.json({ error: 'item (string) is required' }, { status: 400 });
    }

    const points = await scrollNotes(false);
    const note = points.find((p) => p.id === id);
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

    const current = new Set(note.payload.completedActions ?? []);
    if (done) current.add(item);
    else current.delete(item);

    await setPayload(id, { completedActions: [...current] });
    return NextResponse.json({ ok: true, completedActions: [...current] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
