import { NextResponse } from 'next/server';
import { deleteNote } from '@/lib/qdrant';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await deleteNote(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
