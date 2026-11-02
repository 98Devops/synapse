import { NextResponse } from 'next/server';
import { weekPayload } from '@/features/training/db';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/week/:n  (n = 1..weeks, or "current")
 * -> plan, the run's full log (needed for last-time targets), and the rules
 *    computed for that week. The client recomputes the rules live as you type.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ n: string }> }) {
  try {
    const user = await requireUser();
    const { n } = await params;
    const requested = n === 'current' ? 'current' : Number(n);
    if (requested !== 'current' && (!Number.isInteger(requested) || requested < 1 || requested > 52)) {
      return NextResponse.json({ error: 'week must be 1..52 or "current"' }, { status: 400 });
    }
    const db = await supabaseServer();
    return NextResponse.json(await weekPayload(db, user.id, requested));
  } catch (err) {
    return fail(err);
  }
}
