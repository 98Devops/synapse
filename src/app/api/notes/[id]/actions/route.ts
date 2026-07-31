import { NextResponse } from 'next/server';
import { setActionDone } from '@/lib/db/notes';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Toggles a single action item complete/incomplete. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { item, done } = await req.json();
    if (typeof item !== 'string') {
      return NextResponse.json({ error: 'item (string) is required' }, { status: 400 });
    }

    await setActionDone(user.id, id, item, Boolean(done));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
