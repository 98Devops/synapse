import { NextResponse } from 'next/server';
import { createRun, getCurrentRun, importLog, loadProgram } from '@/features/training/db';
import { legacyToLog } from '@/features/training/legacy';
import { dateInZone } from '@/features/training/rules';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST <old log export>
 * Accepts localStorage `sbl` ({ weeks, meta }), the account doc array
 * ([{ id, data }]), or { account, local } to merge both. Creates the run from
 * meta.start when the user has none, otherwise imports into the current run.
 * Idempotent: every row is an upsert on its natural key.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
    }

    const db = await supabaseServer();
    const program = await loadProgram(db);

    let parsed: ReturnType<typeof legacyToLog>;
    try {
      parsed = legacyToLog(body, program);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    let run = await getCurrentRun(db, user.id);
    let created = false;
    if (!run) {
      if (!program.id) {
        return NextResponse.json(
          { error: 'The training program is not in the database yet. Run migration 003.' },
          { status: 503 }
        );
      }
      run = await createRun(db, user.id, program.id, parsed.start ?? dateInZone());
      created = true;
    }

    const counts = await importLog(db, user.id, run.id, parsed.log);
    return NextResponse.json({ run, created, counts, warnings: parsed.warnings });
  } catch (err) {
    return fail(err);
  }
}
