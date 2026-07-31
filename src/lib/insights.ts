import type { GraphData, GraphNode, Note } from './types';

export interface Insight {
  hubs: GraphNode[];
  orphans: Note[];
  openActions: Array<{ note: Note; item: string }>;
  doneCount: number;
  /** notes per day for the last 14 days, oldest first */
  activity: number[];
  busiestDay: string | null;
  sentimentMix: Record<string, number>;
}

export function computeInsights(graph: GraphData, notes: Note[]): Insight {
  const hubs = graph.nodes
    .filter((n) => n.kind === 'entity')
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 6);

  // A note is an orphan if nothing links it to the rest of the brain.
  const connected = new Set<string>();
  for (const e of graph.edges) {
    connected.add(e.source);
    connected.add(e.target);
  }
  const degreeById = new Map(graph.nodes.map((n) => [n.id, n.degree]));
  const orphans = notes.filter((n) => (degreeById.get(n.id) ?? 0) === 0);

  const openActions: Array<{ note: Note; item: string }> = [];
  let doneCount = 0;
  for (const note of notes) {
    const done = new Set(note.completedActions ?? []);
    for (const item of note.actionItems ?? []) {
      if (done.has(item)) doneCount++;
      else openActions.push({ note, item });
    }
  }

  // 14-day activity histogram
  const days = 14;
  const activity = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const counts = new Map<string, number>();

  for (const n of notes) {
    const d = new Date(n.createdAt);
    d.setHours(0, 0, 0, 0);
    const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
    if (diff >= 0 && diff < days) activity[days - 1 - diff]++;
    const key = d.toDateString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let busiestDay: string | null = null;
  let max = 0;
  for (const [day, c] of counts) {
    if (c > max) {
      max = c;
      busiestDay = day;
    }
  }

  const sentimentMix: Record<string, number> = {};
  for (const n of notes) sentimentMix[n.sentiment] = (sentimentMix[n.sentiment] ?? 0) + 1;

  return { hubs, orphans, openActions, doneCount, activity, busiestDay, sentimentMix };
}
