import { NextResponse } from 'next/server';
import { insertNote } from '@/lib/db/notes';
import { claimOrphanNotes, scrollNotes } from '@/lib/qdrant';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';
import type { Note } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * One-shot adoption of notes recorded before auth existed. Notes in Qdrant with
 * no userId are claimed by the caller, then mirrored into Postgres. Idempotent:
 * anything already in Postgres is skipped.
 */
export async function POST() {
  try {
    const user = await requireUser();

    const claimed = await claimOrphanNotes(user.id);
    const points = await scrollNotes(user.id, false);

    const supabase = await supabaseServer();
    const { data: existing } = await supabase.from('notes').select('id').eq('user_id', user.id);
    const known = new Set((existing ?? []).map((r) => r.id));

    let mirrored = 0;
    const failures: string[] = [];

    for (const p of points) {
      if (known.has(p.id)) continue;
      const note: Note = { id: p.id, ...p.payload };
      try {
        // Pre-classification notes go to review rather than pretending to be filed.
        await insertNote(
          user.id,
          note,
          { status: 'needs_review', spaceId: null, threadId: null, reason: 'Recorded before classification existed' },
          null
        );
        mirrored++;
      } catch (err) {
        failures.push(`${note.title}: ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      claimed,
      mirrored,
      alreadyPresent: known.size,
      failures,
    });
  } catch (err) {
    return fail(err);
  }
}
