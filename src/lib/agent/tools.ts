import { tool } from 'langchain';
import { z } from 'zod';
import { embed } from '@/lib/gemini';
import { buildGraph, expandOneHop } from '@/lib/graph';
import { scrollNotes, searchNotes } from '@/lib/qdrant';
import type { Note } from '@/lib/types';

/**
 * Tool results are what the agent reasons over, so they are formatted as
 * compact readable text rather than raw JSON — it reduces token burn and the
 * model follows citations more reliably.
 */

const entityKey = (name: string, type: string) =>
  `entity:${type}:${name.trim().toLowerCase().replace(/\s+/g, '-')}`;

function summarise(note: Note & { score?: number }, index?: number) {
  return [
    `${index !== undefined ? `[${index}] ` : ''}id=${note.id}`,
    `title: ${note.title}`,
    note.score !== undefined ? `relevance: ${(note.score * 100).toFixed(0)}%` : '',
    `date: ${new Date(note.createdAt).toDateString()}`,
    `sentiment: ${note.sentiment}`,
    note.entities?.length ? `entities: ${note.entities.map((e) => `${e.name} (${e.type})`).join(', ')}` : '',
    note.tags?.length ? `tags: ${note.tags.join(', ')}` : '',
    note.actionItems?.length ? `actions: ${note.actionItems.join(' | ')}` : '',
    `text: ${note.text}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Ids the agent actually looked at, so the UI can highlight them in the graph. */
export interface ToolTrace {
  touchedNotes: Set<string>;
}

export function buildTools(trace: ToolTrace) {
  const searchNotesTool = tool(
    async ({ query, limit }) => {
      const vector = await embed(query, 'RETRIEVAL_QUERY');
      const hits = await searchNotes(vector, limit ?? 5);
      if (hits.length === 0) return 'No notes found. The brain may be empty.';
      hits.forEach((h) => trace.touchedNotes.add(h.id));
      return hits
        .map((h, i) => summarise({ id: h.id, ...h.payload, score: h.score }, i + 1))
        .join('\n\n---\n\n');
    },
    {
      name: 'search_notes',
      description:
        'Semantic search across the user\'s notes by meaning, not keywords. Use this first for almost any question about what the user has recorded. Returns notes with ids you can cite.',
      schema: z.object({
        query: z.string().describe('What to look for, phrased as a statement or question'),
        limit: z.number().optional().describe('How many notes to return (default 5, max 10)'),
      }),
    }
  );

  const relatedNotesTool = tool(
    async ({ noteId }) => {
      const points = await scrollNotes(false);
      const expanded = expandOneHop(points, [noteId]).filter((p) => p.id !== noteId);
      if (expanded.length === 0) return 'No related notes — this one shares no entities with anything else.';
      expanded.forEach((p) => trace.touchedNotes.add(p.id));
      return expanded
        .slice(0, 6)
        .map((p, i) => summarise({ id: p.id, ...p.payload }, i + 1))
        .join('\n\n---\n\n');
    },
    {
      name: 'related_notes',
      description:
        'Given a note id, find other notes connected to it through shared entities (people, projects, tools). Use this to follow a thread and discover connections that plain search would miss.',
      schema: z.object({ noteId: z.string().describe('The id of the note to expand from') }),
    }
  );

  const entityNotesTool = tool(
    async ({ entityName }) => {
      const points = await scrollNotes(false);
      const needle = entityName.trim().toLowerCase();
      const matches = points.filter((p) =>
        (p.payload.entities || []).some((e) => e.name.toLowerCase().includes(needle))
      );
      if (matches.length === 0) return `No notes mention an entity matching "${entityName}".`;
      matches.forEach((p) => trace.touchedNotes.add(p.id));
      return matches
        .slice(0, 8)
        .map((p, i) => summarise({ id: p.id, ...p.payload }, i + 1))
        .join('\n\n---\n\n');
    },
    {
      name: 'entity_notes',
      description:
        'Find every note mentioning a specific person, project, organisation or tool. Use when the user asks about a named thing, e.g. "what do I know about Sarah".',
      schema: z.object({ entityName: z.string().describe('Name of the person, project, org or tool') }),
    }
  );

  const graphOverviewTool = tool(
    async () => {
      const points = await scrollNotes(true);
      if (points.length === 0) return 'The brain is empty — no notes recorded yet.';
      const graph = buildGraph(points);
      const hubs = graph.nodes
        .filter((n) => n.kind === 'entity')
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 10);

      const dates = points.map((p) => new Date(p.payload.createdAt).getTime());
      return [
        `Notes: ${graph.stats.notes}`,
        `Entities: ${graph.stats.entities}`,
        `Connections: ${graph.stats.connections}`,
        `Date range: ${new Date(Math.min(...dates)).toDateString()} → ${new Date(Math.max(...dates)).toDateString()}`,
        '',
        'Most connected entities:',
        ...hubs.map((h) => `- ${h.label} (${h.variant}, ${h.degree} links)`),
      ].join('\n');
    },
    {
      name: 'graph_overview',
      description:
        'High-level shape of the whole knowledge graph: counts, date range, and the most connected entities. Use for questions like "what do I know about", "summarise my brain", or to orient before digging in.',
      schema: z.object({}),
    }
  );

  const listActionsTool = tool(
    async ({ includeCompleted }) => {
      const points = await scrollNotes(false);
      const rows: string[] = [];
      for (const p of points) {
        const done = new Set(p.payload.completedActions ?? []);
        for (const item of p.payload.actionItems ?? []) {
          const isDone = done.has(item);
          if (isDone && !includeCompleted) continue;
          rows.push(`- [${isDone ? 'x' : ' '}] ${item}  (from "${p.payload.title}", id=${p.id})`);
        }
      }
      return rows.length ? rows.join('\n') : 'No action items recorded.';
    },
    {
      name: 'list_action_items',
      description:
        'List action items the user committed to across all notes. Use for "what do I need to do", "what am I forgetting", "what is outstanding".',
      schema: z.object({
        includeCompleted: z.boolean().optional().describe('Include already-completed items (default false)'),
      }),
    }
  );

  const recentNotesTool = tool(
    async ({ limit }) => {
      const points = await scrollNotes(false);
      const recent = points
        .sort((a, b) => (a.payload.createdAt < b.payload.createdAt ? 1 : -1))
        .slice(0, limit ?? 5);
      if (recent.length === 0) return 'No notes recorded yet.';
      recent.forEach((p) => trace.touchedNotes.add(p.id));
      return recent.map((p, i) => summarise({ id: p.id, ...p.payload }, i + 1)).join('\n\n---\n\n');
    },
    {
      name: 'recent_notes',
      description:
        'The most recently recorded notes, newest first. Use for "what have I been thinking about lately" or "catch me up".',
      schema: z.object({ limit: z.number().optional().describe('How many (default 5)') }),
    }
  );

  return [
    searchNotesTool,
    relatedNotesTool,
    entityNotesTool,
    graphOverviewTool,
    listActionsTool,
    recentNotesTool,
  ];
}
