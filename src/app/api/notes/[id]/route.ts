import { NextResponse } from 'next/server';
import { removeNote } from '@/lib/db/notes';
import { deleteNote } from '@/lib/qdrant';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    // Postgres delete is RLS-guarded, so a foreign id simply affects no rows.
    await removeNote(user.id, id);
    await deleteNote(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
