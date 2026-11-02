import { generateJson } from './gemini';
import { listNotes } from './db/notes';
import { computeSignals, type Signals } from './patterns';
import { supabaseServer } from './supabase/server';
import type { Note } from './types';

/**
 * The pattern-recognition layer: reads across everything you've said (and
 * trained), and tells you how you're changing — the loops you keep circling,
 * what's rising, what you've quietly dropped, where one part of life is
 * touching another.
 *
 * It learns from you: every highlight can be marked useful or not, and those
 * judgements are fed into the next run as the user's own taste.
 */

export type HighlightKind = 'theme' | 'shift' | 'loop' | 'link' | 'growth' | 'nudge';

export interface Highlight {
  id: string;
  kind: HighlightKind;
  title: string;
  body: string;
  noteIds: string[];
  score: number;
  feedback: 'useful' | 'not_useful' | null;
  createdAt: string;
}

const KINDS: HighlightKind[] = ['theme', 'shift', 'loop', 'link', 'growth', 'nudge'];

/** Don't regenerate more often than this unless forced; Gemini free quota is thin. */
const MIN_INTERVAL_MS = 10 * 60_000;

function rowToHighlight(r: any): Highlight {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    noteIds: r.note_ids ?? [],
    score: r.score ?? 0.5,
    feedback: r.feedback ?? null,
    createdAt: r.created_at,
  };
}

export async function listHighlights(userId: string, limit = 12): Promise<Highlight[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('highlights')
    .select('id, kind, title, body, note_ids, score, feedback, created_at')
    .eq('user_id', userId)
    .or('feedback.is.null,feedback.eq.useful')
    .order('created_at', { ascending: false })
    .order('score', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`list highlights: ${error.message}`);
  return (data ?? []).map(rowToHighlight);
}

export async function rateHighlight(userId: string, id: string, feedback: 'useful' | 'not_useful' | null) {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from('highlights')
    .update({ feedback, feedback_at: feedback ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(`rate highlight: ${error.message}`);
}

/** Is it worth generating again? New notes since the last run, or a day has passed. */
export function isStale(latest: Highlight | undefined, notes: Note[], now = Date.now()) {
  if (!notes.length) return false;
  if (!latest) return true;
  const last = new Date(latest.createdAt).getTime();
  if (now - last < MIN_INTERVAL_MS) return false;
  return now - last > 86_400_000 || notes.some((n) => new Date(n.createdAt).getTime() > last);
}

/** Training context, if the training module has data. Absent tables are not an error. */
async function trainingContext(userId: string) {
  const supabase = await supabaseServer();
  const [checkins, sessions] = await Promise.all([
    supabase
      .from('weekly_checkins')
      .select('week, weight_kg, sleep_h, food, notes, updated_at')
      .eq('user_id', userId)
      .order('week'),
    supabase
      .from('training_sessions')
      .select('week, slot, workout, date, done')
      .eq('user_id', userId)
      .order('week'),
  ]);
  if (checkins.error && sessions.error) return null;
  const c = checkins.data ?? [];
  const s = sessions.data ?? [];
  if (!c.length && !s.length) return null;
  return {
    checkins: c,
    sessionsDone: s.filter((x: any) => x.done).map((x: any) => ({ week: x.week, workout: x.workout, date: x.date })),
  };
}

async function feedbackHistory(userId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('highlights')
    .select('kind, title, feedback')
    .eq('user_id', userId)
    .not('feedback', 'is', null)
    .order('feedback_at', { ascending: false })
    .limit(30);
  const rows = data ?? [];
  return {
    liked: rows.filter((r: any) => r.feedback === 'useful').map((r: any) => `[${r.kind}] ${r.title}`),
    disliked: rows.filter((r: any) => r.feedback === 'not_useful').map((r: any) => `[${r.kind}] ${r.title}`),
  };
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    highlights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: KINDS },
          title: { type: 'STRING' },
          body: { type: 'STRING' },
          noteIds: { type: 'ARRAY', items: { type: 'STRING' } },
          score: { type: 'NUMBER' },
        },
        required: ['kind', 'title', 'body', 'noteIds', 'score'],
      },
    },
  },
  required: ['highlights'],
};

function compactNote(n: Note) {
  return {
    id: n.id,
    date: n.createdAt.slice(0, 10),
    title: n.title,
    summary: n.summary,
    intent: n.intent,
    sentiment: n.sentiment,
    entities: n.entities.map((e) => e.name),
    tags: n.tags,
    openActions: n.actionItems.filter((a) => !(n.completedActions ?? []).includes(a)),
    decisions: n.decisions.map((d) => d.text),
    questions: n.questions,
  };
}

function buildPrompt(
  notes: Note[],
  signals: Signals,
  training: Awaited<ReturnType<typeof trainingContext>>,
  taste: Awaited<ReturnType<typeof feedbackHistory>>
) {
  return `You are the pattern-recognition layer of one person's second brain. You have everything they have said into it. Your job is to show them how they are evolving — things they would not notice themselves.

Write 3 to 6 highlights. Each is one of:
- theme: a subject that has become central
- shift: something that changed — rising, fading, or a change in how they talk about it
- loop: something they keep circling without resolving (a recurring worry, a repeated intention)
- link: two areas of life that are connected and they may not have joined the dots (e.g. sleep and mood, training and energy, a person who appears across projects)
- growth: evidence of follow-through, a decision acted on, progress
- nudge: one concrete, specific next step grounded in their own words

Rules:
- Speak to them directly ("you"). Plain, warm, specific. No therapy-speak, no generic advice.
- Every claim must be grounded in the notes or signals below. Quote or name the specific thing.
- noteIds: ONLY ids from the notes list that support the highlight (1-5).
- title: under 60 characters. body: 1-3 sentences.
- score: 0-1, how much this would matter to them.
- With few notes, write fewer, smaller highlights rather than stretching.
${taste.liked.length ? `\nThey found these kinds of highlights useful — do more like this:\n${taste.liked.map((t) => `- ${t}`).join('\n')}` : ''}
${taste.disliked.length ? `\nThey marked these NOT useful — avoid this kind of observation:\n${taste.disliked.map((t) => `- ${t}`).join('\n')}` : ''}

Computed signals (deterministic, trust these numbers):
${JSON.stringify({
  rising: signals.rising.map((t) => ({ name: t.name, recent: t.recent, before: t.before })),
  fading: signals.fading.map((t) => ({ name: t.name, before: t.before })),
  loops: signals.loops.map((l) => ({ name: l.name, count: l.count, heaviness: Number(l.heaviness.toFixed(2)) })),
  mood: signals.mood,
  staleActions: signals.staleActions,
  captureRate: signals.captureRate,
})}
${training ? `\nTraining log (weekly check-ins and completed sessions):\n${JSON.stringify(training)}` : ''}

Today is ${new Date().toISOString().slice(0, 10)}.

Notes (newest first):
${JSON.stringify(notes.slice(0, 80).map(compactNote))}`;
}

export async function generateHighlights(userId: string): Promise<Highlight[]> {
  const notes = await listNotes(userId);
  if (!notes.length) return [];

  const signals = computeSignals(notes);
  const [training, taste] = await Promise.all([trainingContext(userId), feedbackHistory(userId)]);

  const out = await generateJson(buildPrompt(notes, signals, training, taste), SCHEMA);
  const valid = new Set(notes.map((n) => n.id));

  const rows = (out?.highlights ?? [])
    .filter((h: any) => KINDS.includes(h.kind) && h.title && h.body)
    .slice(0, 6)
    .map((h: any) => ({
      user_id: userId,
      kind: h.kind,
      title: String(h.title).slice(0, 120),
      body: String(h.body).slice(0, 600),
      note_ids: (h.noteIds ?? []).filter((id: string) => valid.has(id)).slice(0, 5),
      score: Math.max(0, Math.min(1, Number(h.score) || 0.5)),
      evidence: { signals: { rising: signals.rising.length, loops: signals.loops.length } },
    }));

  if (!rows.length) return [];

  const supabase = await supabaseServer();
  // The newest run replaces older unrated highlights; rated ones are kept as
  // the learning history.
  await supabase.from('highlights').delete().eq('user_id', userId).is('feedback', null);
  const { data, error } = await supabase
    .from('highlights')
    .insert(rows)
    .select('id, kind, title, body, note_ids, score, feedback, created_at');
  if (error) throw new Error(`store highlights: ${error.message}`);
  return (data ?? []).map(rowToHighlight).sort((a, b) => b.score - a.score);
}
