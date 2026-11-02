import { NextResponse } from 'next/server';
import { generateHighlights, isStale, listHighlights } from '@/lib/highlights';
import { listNotes } from '@/lib/db/notes';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Current highlights, plus whether they are worth regenerating. Never blocks on the LLM. */
export async function GET() {
  try {
    const user = await requireUser();
    const [highlights, notes] = await Promise.all([listHighlights(user.id), listNotes(user.id)]);
    const latest = [...highlights].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return NextResponse.json({ highlights, stale: isStale(latest, notes) });
  } catch (err) {
    return fail(err);
  }
}

/** Run the pattern engine now. */
export async function POST() {
  try {
    const user = await requireUser();
    const fresh = await generateHighlights(user.id);
    const highlights = fresh.length ? await listHighlights(user.id) : [];
    return NextResponse.json({ highlights, stale: false });
  } catch (err) {
    return fail(err);
  }
}
