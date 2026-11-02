import type { Note, Sentiment } from './types';

/**
 * Deterministic pattern signals over the user's notes. Pure and cheap, so the
 * client renders them instantly; the same signals ground the LLM highlights on
 * the server, which keeps it from inventing trends that aren't there.
 */

export interface ThemeSignal {
  /** entity name or tag, as the user would recognise it */
  name: string;
  recent: number;
  before: number;
  noteIds: string[];
}

export interface LoopSignal {
  name: string;
  count: number;
  /** share of those notes that were negative or urgent */
  heaviness: number;
  noteIds: string[];
}

export interface Signals {
  windowDays: number;
  /** talked about more in the recent window than before */
  rising: ThemeSignal[];
  /** prominent before, gone quiet recently */
  fading: ThemeSignal[];
  /** keeps coming back, often with weight attached */
  loops: LoopSignal[];
  /** sentiment shares, recent vs before (0..1) */
  mood: { recent: Record<Sentiment, number>; before: Record<Sentiment, number> };
  /** actions older than a week that are still open */
  staleActions: Array<{ noteId: string; text: string; ageDays: number }>;
  /** recent notes per week vs before, normalised */
  captureRate: { recentPerWeek: number; beforePerWeek: number };
}

const DAY = 86_400_000;
const SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative', 'urgent'];

function themesOf(n: Note): string[] {
  const out = new Set<string>();
  for (const e of n.entities ?? []) if (e.type !== 'place') out.add(e.name.trim());
  for (const t of n.tags ?? []) out.add(t.trim());
  return [...out].filter(Boolean);
}

function shares(notes: Note[]): Record<Sentiment, number> {
  const out = Object.fromEntries(SENTIMENTS.map((s) => [s, 0])) as Record<Sentiment, number>;
  if (!notes.length) return out;
  for (const n of notes) out[n.sentiment] = (out[n.sentiment] ?? 0) + 1;
  for (const s of SENTIMENTS) out[s] = out[s] / notes.length;
  return out;
}

export function computeSignals(notes: Note[], now = Date.now(), windowDays = 14): Signals {
  const cutoff = now - windowDays * DAY;
  const recent = notes.filter((n) => new Date(n.createdAt).getTime() >= cutoff);
  const before = notes.filter((n) => new Date(n.createdAt).getTime() < cutoff);

  // Case-insensitive tally, keeping the most common spelling for display.
  const tally = new Map<string, ThemeSignal>();
  const bump = (n: Note, isRecent: boolean) => {
    for (const name of themesOf(n)) {
      const key = name.toLowerCase();
      const t = tally.get(key) ?? { name, recent: 0, before: 0, noteIds: [] };
      if (isRecent) t.recent++;
      else t.before++;
      if (!t.noteIds.includes(n.id)) t.noteIds.push(n.id);
      tally.set(key, t);
    }
  };
  recent.forEach((n) => bump(n, true));
  before.forEach((n) => bump(n, false));

  // Compare rates, not counts, so an uneven split of history doesn't skew it.
  const oldestTs = notes.reduce((m, n) => Math.min(m, new Date(n.createdAt).getTime()), now);
  const beforeWeeks = Math.max(1, (cutoff - oldestTs) / (7 * DAY));
  const recentWeeks = windowDays / 7;

  const themes = [...tally.values()];
  const rising = themes
    .filter((t) => t.recent >= 2 && t.recent / recentWeeks > (t.before / beforeWeeks) * 1.5)
    .sort((a, b) => b.recent - a.recent || a.before - b.before)
    .slice(0, 5);
  const fading = before.length
    ? themes
        .filter((t) => t.before >= 2 && t.recent === 0)
        .sort((a, b) => b.before - a.before)
        .slice(0, 5)
    : [];

  const byId = new Map(notes.map((n) => [n.id, n]));
  const loops = themes
    .map((t) => {
      const ns = t.noteIds.map((id) => byId.get(id)!).filter(Boolean);
      const heavy = ns.filter((n) => n.sentiment === 'negative' || n.sentiment === 'urgent').length;
      return { name: t.name, count: ns.length, heaviness: ns.length ? heavy / ns.length : 0, noteIds: t.noteIds };
    })
    .filter((l) => l.count >= 3)
    .sort((a, b) => b.heaviness - a.heaviness || b.count - a.count)
    .slice(0, 5);

  const staleActions: Signals['staleActions'] = [];
  for (const n of notes) {
    const ageDays = Math.floor((now - new Date(n.createdAt).getTime()) / DAY);
    if (ageDays < 7) continue;
    const done = new Set(n.completedActions ?? []);
    for (const text of n.actionItems ?? []) {
      if (!done.has(text)) staleActions.push({ noteId: n.id, text, ageDays });
    }
  }
  staleActions.sort((a, b) => b.ageDays - a.ageDays);

  return {
    windowDays,
    rising,
    fading,
    loops,
    mood: { recent: shares(recent), before: shares(before) },
    staleActions: staleActions.slice(0, 8),
    captureRate: {
      recentPerWeek: recent.length / recentWeeks,
      beforePerWeek: before.length / beforeWeeks,
    },
  };
}
