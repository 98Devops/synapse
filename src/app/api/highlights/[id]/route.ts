import { NextResponse } from 'next/server';
import { rateHighlight } from '@/lib/highlights';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** { feedback: 'useful' | 'not_useful' | null } — the learning signal. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { feedback } = await req.json();
    if (![null, 'useful', 'not_useful'].includes(feedback)) {
      return NextResponse.json({ error: 'feedback must be useful, not_useful or null' }, { status: 400 });
    }
    await rateHighlight(user.id, (await params).id, feedback);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
