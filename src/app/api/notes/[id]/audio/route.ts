import { NextResponse } from 'next/server';
import { getNote } from '@/lib/db/notes';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * A short-lived signed URL for the original recording. The bucket is private,
 * and the note lookup is RLS-guarded, so you can only sign your own audio.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const note = await getNote(user.id, id);
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    if (!note.audioPath) return NextResponse.json({ url: null });

    const supabase = await supabaseServer();
    const { data, error } = await supabase.storage
      .from('recordings')
      .createSignedUrl(note.audioPath, 60 * 30);

    if (error) return NextResponse.json({ url: null, error: error.message });
    return NextResponse.json({ url: data.signedUrl });
  } catch (err) {
    return fail(err);
  }
}
