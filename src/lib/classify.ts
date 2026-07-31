import { supabaseServer } from '@/lib/supabase/server';
import { CONFIDENCE_FLOOR, type Extraction, type NoteStatus } from '@/lib/types';
import type { LearnedExample } from '@/lib/gemini';

/**
 * Turns a raw extraction into a filed note: resolves the Space, picks a Thread,
 * and decides whether it can be filed or needs a human eye.
 */

export interface Placement {
  status: NoteStatus;
  spaceId: string | null;
  threadId: string | null;
  reason?: string;
}

/** Recent corrections, fed back into the extraction prompt as few-shot examples. */
export async function learnedCorrections(userId: string): Promise<LearnedExample[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('corrections')
    .select('field, to_value, note_excerpt')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(8);

  return (data ?? [])
    .filter((c) => c.note_excerpt)
    .map((c) => ({ excerpt: c.note_excerpt, field: c.field, to: c.to_value }));
}

const norm = (s: string) => s.trim().toLowerCase();

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'project', 'work', 'stuff']);
const tokens = (s: string) =>
  new Set(
    norm(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );

/**
 * The model won't name a space identically every time — one capture says
 * "Granite", the next "Granite Partnership". Exact matching split those into two
 * spaces, so compare on token overlap instead.
 */
function sameSpace(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;

  const overlap = [...ta].filter((t) => tb.has(t)).length;
  // One name fully contained in the other ("Granite" ⊂ "Granite Partnership").
  if (overlap === Math.min(ta.size, tb.size)) return true;

  const union = new Set([...ta, ...tb]).size;
  return overlap / union >= 0.6;
}

/**
 * Finds the space by name, creating it if the model proposed a new one. Only
 * creates when confidence is decent — a low-confidence guess shouldn't litter
 * the sidebar with junk spaces.
 */
async function resolveSpace(
  userId: string,
  suggested: string | undefined,
  confident: boolean
): Promise<string | null> {
  if (!suggested) return null;
  const supabase = await supabaseServer();

  const { data: existing } = await supabase
    .from('spaces')
    .select('id, name')
    .eq('user_id', userId);

  const match = (existing ?? []).find((s) => sameSpace(s.name, suggested));
  if (match) return match.id;
  if (!confident) return null;

  const { data, error } = await supabase
    .from('spaces')
    .insert({ user_id: userId, name: suggested.trim() })
    .select('id')
    .single();

  if (error) {
    // Unique violation means a concurrent capture created it first.
    const { data: again } = await supabase
      .from('spaces')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', suggested.trim())
      .maybeSingle();
    return again?.id ?? null;
  }
  return data.id;
}

/**
 * A note joins an existing thread when it shares the space and is semantically
 * close to that thread's most recent note. Otherwise it starts a new one.
 */
async function resolveThread(
  userId: string,
  spaceId: string | null,
  title: string,
  similarNoteIds: string[]
): Promise<string | null> {
  if (!spaceId) return null;
  const supabase = await supabaseServer();

  // If any semantically-similar note already sits in a thread in this space, join it.
  if (similarNoteIds.length) {
    const { data: siblings } = await supabase
      .from('notes')
      .select('thread_id')
      .eq('user_id', userId)
      .eq('space_id', spaceId)
      .in('id', similarNoteIds)
      .not('thread_id', 'is', null)
      .limit(1);

    if (siblings?.[0]?.thread_id) return siblings[0].thread_id;
  }

  const { data, error } = await supabase
    .from('threads')
    .insert({ user_id: userId, space_id: spaceId, title })
    .select('id')
    .single();

  return error ? null : data.id;
}

export async function placeNote(
  userId: string,
  extraction: Extraction,
  similarNoteIds: string[]
): Promise<Placement> {
  const confident = extraction.intentConfidence >= CONFIDENCE_FLOOR;
  const classified = extraction.intent !== 'unclassified';

  const spaceId = await resolveSpace(userId, extraction.suggestedSpace, confident && classified);

  if (!confident || !classified) {
    return {
      status: 'needs_review',
      spaceId,
      threadId: null,
      reason:
        extraction.unclassifiedReason ??
        (!classified
          ? 'No dominant intent in this note'
          : `Low confidence (${Math.round(extraction.intentConfidence * 100)}%)`),
    };
  }

  // Confident but homeless: still filed, just not in a space yet.
  if (!spaceId) {
    return { status: 'filed', spaceId: null, threadId: null };
  }

  const threadId = await resolveThread(userId, spaceId, extraction.title, similarNoteIds);
  return { status: 'filed', spaceId, threadId };
}

/** Records a manual reclassification so the extractor learns from it. */
export async function recordCorrection(
  userId: string,
  noteId: string,
  field: 'intent' | 'space' | 'entity',
  from: string | null,
  to: string,
  excerpt: string
) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('corrections').insert({
    user_id: userId,
    note_id: noteId,
    field,
    from_value: from,
    to_value: to,
    note_excerpt: excerpt.slice(0, 300),
  });
  if (error) console.error('[classify] recordCorrection:', error.message);
}
