import { NextResponse } from 'next/server';
import { createRun, getCurrentRun, loadProgram } from '@/features/training/db';
import { currentWeek } from '@/features/training/rules';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';
import { parseBody, startRunSchema } from '../schemas';

export const dynamic = 'force-dynamic';

/** GET -> { run, program, current: { week, complete } } (run is null before the first start). */
export async function GET() {
  try {
    const user = await requireUser();
    const db = await supabaseServer();
    const [program, run] = await Promise.all([loadProgram(db), getCurrentRun(db, user.id)]);
    return NextResponse.json({ run, program, current: currentWeek(run?.startDate ?? null, new Date(), program.weeks) });
  } catch (err) {
    return fail(err);
  }
}

/** POST { startDate } -> starts a new run of the program (also "start next program"). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, startRunSchema);
    if (!body.ok) return body.res;
    const db = await supabaseServer();
    const program = await loadProgram(db);
    if (!program.id) {
      return NextResponse.json(
        { error: 'The training program is not in the database yet. Run migration 003.' },
        { status: 503 }
      );
    }
    const run = await createRun(db, user.id, program.id, body.data.startDate);
    return NextResponse.json({ run, current: currentWeek(run.startDate, new Date(), program.weeks) });
  } catch (err) {
    return fail(err);
  }
}
