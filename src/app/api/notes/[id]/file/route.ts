import { NextResponse } from 'next/server';
import { fileNote, getNote, listSpaces } from '@/lib/db/notes';
import { recordCorrection } from '@/lib/classify';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Resolves a note that needed review. Every change is also recorded as a
 * correction, which feeds back into future classification.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { intent, spaceName, status } = await req.json();

    const note = await getNote(user.id, id);
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

    let spaceId: string | null | undefined;
    if (spaceName !== undefined) {
      if (!spaceName) {
        spaceId = null;
      } else {
        const spaces = await listSpaces(user.id);
        spaceId = spaces.find((s) => s.name.toLowerCase() === spaceName.toLowerCase())?.id ?? null;
      }
    }

    await fileNote(user.id, id, { intent, spaceId, status: status ?? 'filed' });

    if (intent && intent !== note.intent) {
      await recordCorrection(user.id, id, 'intent', note.intent, intent, note.text);
    }
    if (spaceName && spaceName !== note.spaceName) {
      await recordCorrection(user.id, id, 'space', note.spaceName ?? null, spaceName, note.text);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
