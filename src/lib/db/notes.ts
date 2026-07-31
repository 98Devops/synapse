import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';
import type { Citation, Note, NoteStatus, Space } from '@/lib/types';
import type { Placement } from '@/lib/classify';

/**
 * Postgres is the source of truth; Qdrant is a derived index. Everything runs
 * through the user-scoped client, so RLS enforces isolation even if a query
 * forgets its own user_id filter.
 */

// NOTE: no SQL comments in here — PostgREST parses this string literally.
// `questions` has two FKs to notes (note_id, resolved_by), so the constraint
// must be named explicitly or the embed is ambiguous.
const NOTE_SELECT = `
  id, title, text, summary, sentiment, tags, source, created_at,
  intent, intent_confidence, status, space_id, thread_id, unclassified_reason, audio_path,
  spaces ( name ),
  actions ( text, done, owner, due_date, priority ),
  data_points ( label, value, unit, kind ),
  questions!questions_note_id_fkey ( text, resolved ),
  decisions ( text, alternatives ),
  note_entities ( entities ( name, type ) )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToNote(row: any): Note {
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    summary: row.summary,
    sentiment: row.sentiment,
    tags: row.tags ?? [],
    source: row.source,
    createdAt: row.created_at,
    status: row.status as NoteStatus,
    intent: row.intent,
    intentConfidence: row.intent_confidence ?? 0,
    unclassifiedReason: row.unclassified_reason ?? undefined,
    spaceId: row.space_id,
    spaceName: row.spaces?.name ?? null,
    threadId: row.thread_id,
    audioPath: row.audio_path,

    entities: (row.note_entities ?? [])
      .map((ne: any) => ne.entities)
      .filter(Boolean),
    actions: (row.actions ?? []).map((a: any) => ({
      text: a.text,
      owner: a.owner ?? undefined,
      dueDate: a.due_date ?? undefined,
      priority: a.priority ?? 'normal',
    })),
    actionItems: (row.actions ?? []).map((a: any) => a.text),
    completedActions: (row.actions ?? []).filter((a: any) => a.done).map((a: any) => a.text),
    dataPoints: (row.data_points ?? []).map((d: any) => ({
      label: d.label,
      value: d.value,
      unit: d.unit ?? undefined,
      kind: d.kind,
    })),
    questions: (row.questions ?? []).map((q: any) => q.text),
    decisions: (row.decisions ?? []).map((d: any) => ({
      text: d.text,
      alternatives: d.alternatives ?? [],
    })),
  };
}

/**
 * Just the note row. This is the only write on the capture critical path —
 * everything else is deferred so the user gets their confirmation sooner.
 */
export async function insertNoteRow(
  userId: string,
  note: Note,
  placement: Placement,
  audioPath?: string | null
) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('notes').insert({
    id: note.id,
    user_id: userId,
    title: note.title,
    text: note.text,
    summary: note.summary,
    sentiment: note.sentiment,
    tags: note.tags,
    source: note.source,
    audio_path: audioPath ?? null,
    created_at: note.createdAt,
    intent: note.intent,
    intent_confidence: note.intentConfidence,
    status: placement.status,
    space_id: placement.spaceId,
    thread_id: placement.threadId,
    unclassified_reason: placement.reason ?? null,
  });
  if (error) throw new Error(`insert note: ${error.message}`);
}

/**
 * Entities and facets, written after the response has gone out. Uses the
 * service-role client because the request's cookie scope is gone by then; the
 * user_id is taken from the already-verified session, never from input.
 *
 * Every independent write runs concurrently — these were eight sequential
 * round trips at ~450ms each.
 */
export async function insertFacets(userId: string, note: Note) {
  const supabase = supabaseAdmin();
  // Supabase builders are thenable rather than real Promises.
  const jobs: Array<PromiseLike<unknown>> = [];

  if (note.actions.length) {
    jobs.push(
      supabase.from('actions').insert(
        note.actions.map((a) => ({
          note_id: note.id,
          user_id: userId,
          text: a.text,
          owner: a.owner ?? null,
          due_date: a.dueDate ?? null,
          priority: a.priority ?? 'normal',
        }))
      )
    );
  }
  if (note.dataPoints.length) {
    jobs.push(
      supabase.from('data_points').insert(
        note.dataPoints.map((d) => ({
          note_id: note.id,
          user_id: userId,
          label: d.label,
          value: d.value,
          unit: d.unit ?? null,
          kind: d.kind,
        }))
      )
    );
  }
  if (note.questions.length) {
    jobs.push(
      supabase
        .from('questions')
        .insert(note.questions.map((text) => ({ note_id: note.id, user_id: userId, text })))
    );
  }
  if (note.decisions.length) {
    jobs.push(
      supabase.from('decisions').insert(
        note.decisions.map((d) => ({
          note_id: note.id,
          user_id: userId,
          text: d.text,
          alternatives: d.alternatives,
        }))
      )
    );
  }

  // Entities must resolve before they can be linked, so they're their own chain.
  jobs.push(linkEntities(userId, note));

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[db] facet write failed:', r.reason);
  }
}

async function linkEntities(userId: string, note: Note) {
  if (!note.entities.length) return;
  const supabase = supabaseAdmin();

  const { data: existing } = await supabase
    .from('entities')
    .select('id, name, type')
    .eq('user_id', userId);

  const key = (n: string, t: string) => `${t}:${n.trim().toLowerCase()}`;
  const known = new Map((existing ?? []).map((e) => [key(e.name, e.type), e.id]));

  const missing = note.entities.filter((e) => !known.has(key(e.name, e.type)));
  if (missing.length) {
    const { data: created } = await supabase
      .from('entities')
      .insert(missing.map((e) => ({ user_id: userId, name: e.name, type: e.type })))
      .select('id, name, type');
    for (const e of created ?? []) known.set(key(e.name, e.type), e.id);
  }

  const links = note.entities
    .map((e) => known.get(key(e.name, e.type)))
    .filter((id): id is string => Boolean(id))
    .map((entity_id) => ({ note_id: note.id, entity_id }));

  if (links.length) {
    await supabase.from('note_entities').upsert(links, { onConflict: 'note_id,entity_id' });
  }
}

/** Full synchronous write. Used by the migration, which is not latency-sensitive. */
export async function insertNote(
  userId: string,
  note: Note,
  placement: Placement,
  audioPath?: string | null
) {
  const supabase = await supabaseServer();

  const { error: noteErr } = await supabase.from('notes').insert({
    id: note.id,
    user_id: userId,
    title: note.title,
    text: note.text,
    summary: note.summary,
    sentiment: note.sentiment,
    tags: note.tags,
    source: note.source,
    audio_path: audioPath ?? null,
    created_at: note.createdAt,
    intent: note.intent,
    intent_confidence: note.intentConfidence,
    status: placement.status,
    space_id: placement.spaceId,
    thread_id: placement.threadId,
    unclassified_reason: placement.reason ?? null,
  });
  if (noteErr) throw new Error(`insert note: ${noteErr.message}`);

  // --- entities (shared across notes, so upsert then link) ---
  if (note.entities.length) {
    const { data: existing } = await supabase
      .from('entities')
      .select('id, name, type')
      .eq('user_id', userId);

    const key = (n: string, t: string) => `${t}:${n.trim().toLowerCase()}`;
    const known = new Map((existing ?? []).map((e) => [key(e.name, e.type), e.id]));

    const missing = note.entities.filter((e) => !known.has(key(e.name, e.type)));
    if (missing.length) {
      const { data: created } = await supabase
        .from('entities')
        .insert(missing.map((e) => ({ user_id: userId, name: e.name, type: e.type })))
        .select('id, name, type');
      for (const e of created ?? []) known.set(key(e.name, e.type), e.id);
    }

    const links = note.entities
      .map((e) => known.get(key(e.name, e.type)))
      .filter((id): id is string => Boolean(id))
      .map((entity_id) => ({ note_id: note.id, entity_id }));

    if (links.length) {
      await supabase.from('note_entities').upsert(links, { onConflict: 'note_id,entity_id' });
    }
  }

  // --- facets ---
  if (note.actions.length) {
    await supabase.from('actions').insert(
      note.actions.map((a) => ({
        note_id: note.id,
        user_id: userId,
        text: a.text,
        owner: a.owner ?? null,
        due_date: a.dueDate ?? null,
        priority: a.priority ?? 'normal',
      }))
    );
  }
  if (note.dataPoints.length) {
    await supabase.from('data_points').insert(
      note.dataPoints.map((d) => ({
        note_id: note.id,
        user_id: userId,
        label: d.label,
        value: d.value,
        unit: d.unit ?? null,
        kind: d.kind,
      }))
    );
  }
  if (note.questions.length) {
    await supabase
      .from('questions')
      .insert(note.questions.map((text) => ({ note_id: note.id, user_id: userId, text })));
  }
  if (note.decisions.length) {
    await supabase.from('decisions').insert(
      note.decisions.map((d) => ({
        note_id: note.id,
        user_id: userId,
        text: d.text,
        alternatives: d.alternatives,
      }))
    );
  }
}

export async function listNotes(userId: string, status?: NoteStatus): Promise<Note[]> {
  const supabase = await supabaseServer();
  let q = supabase.from('notes').select(NOTE_SELECT).eq('user_id', userId);
  if (status) q = q.eq('status', status);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(`list notes: ${error.message}`);
  return (data ?? []).map(rowToNote);
}

export async function getNote(userId: string, id: string): Promise<Note | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('notes')
    .select(NOTE_SELECT)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  return data ? rowToNote(data) : null;
}

export async function listSpaces(userId: string): Promise<Space[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('spaces')
    .select('id, name, description, color, notes(count)')
    .eq('user_id', userId)
    .order('name');
  if (error) throw new Error(`list spaces: ${error.message}`);

  return (data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    color: s.color,
    noteCount: s.notes?.[0]?.count ?? 0,
  }));
}

/** Moves a note out of review — the human decision the system asked for. */
export async function fileNote(
  userId: string,
  id: string,
  patch: { intent?: string; spaceId?: string | null; status?: NoteStatus }
) {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from('notes')
    .update({
      ...(patch.intent ? { intent: patch.intent } : {}),
      ...(patch.spaceId !== undefined ? { space_id: patch.spaceId } : {}),
      status: patch.status ?? 'filed',
      reviewed_at: new Date().toISOString(),
      unclassified_reason: null,
    })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`file note: ${error.message}`);
}

export async function createSpace(userId: string, name: string): Promise<Space> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('spaces')
    .insert({ user_id: userId, name: name.trim() })
    .select('id, name, description, color')
    .single();
  if (error) throw new Error(`create space: ${error.message}`);
  return { ...data, noteCount: 0 };
}

export async function removeNote(userId: string, id: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('notes').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`delete note: ${error.message}`);
}

export async function setActionDone(userId: string, noteId: string, text: string, done: boolean) {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from('actions')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('user_id', userId)
    .eq('note_id', noteId)
    .eq('text', text);
  if (error) throw new Error(`update action: ${error.message}`);
}

export async function saveConversation(
  userId: string,
  entry: { query: string; answer: string; citations: Citation[]; tools: string[] }
) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('conversations').insert({
    user_id: userId,
    query: entry.query,
    answer: entry.answer,
    citations: entry.citations,
    tools_used: entry.tools,
  });
  if (error) console.error('[db] saveConversation:', error.message);
}
