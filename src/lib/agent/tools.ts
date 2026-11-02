import { tool } from 'langchain';
import { z } from 'zod';
import { buildGraph, expandOneHop } from '@/lib/graph';
import { hybridSearch } from '@/lib/retrieval';
import { fileNote, getNote, listNotes, listSpaces } from '@/lib/db/notes';
import { recordCorrection } from '@/lib/classify';
import { supabaseServer } from '@/lib/supabase/server';
import { scrollNotes } from '@/lib/qdrant';
import { INTENTS, type Note } from '@/lib/types';
import { getCurrentRun, loadLog, loadProgram } from '@/features/training/db';
import { currentWeek, summarizeRun } from '@/features/training/rules';

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

export function buildTools(trace: ToolTrace, userId: string) {
  /**
   * Every tool used to re-scroll the whole collection from Qdrant, so a
   * three-tool answer paid that round trip three times. One in-flight promise
   * per request means it happens once, and concurrent tools share it.
   */
  let notesPromise: Promise<Awaited<ReturnType<typeof scrollNotes>>> | null = null;
  let vectoredPromise: Promise<Awaited<ReturnType<typeof scrollNotes>>> | null = null;
  const allNotes = () => (notesPromise ??= scrollNotes(userId, false));
  // Only graph_overview needs vectors; they're heavy, so cache them separately.
  const allNotesWithVectors = () => (vectoredPromise ??= scrollNotes(userId, true));

  const searchNotesTool = tool(
    async ({ query, limit, intent }) => {
      // Hybrid: vector over notes AND facets, fused with keyword search, reranked.
      const hits = await hybridSearch(userId, query, {
        limit: limit ?? 5,
        rerank: true,
        ...(intent ? { intent } : {}),
      });
      if (hits.length === 0) return 'No notes found. The brain may be empty.';

      const notes = await allNotes();
      const byId = new Map(notes.map((p) => [p.id, p.payload]));

      return hits
        .map((h, i) => {
          const payload = byId.get(h.noteId);
          if (!payload) return null;
          trace.touchedNotes.add(h.noteId);
          return `${summarise({ id: h.noteId, ...payload } as Note, i + 1)}\nmatched via: ${h.via.join(', ')}`;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');
    },
    {
      name: 'search_notes',
      description:
        "Hybrid semantic + keyword search across the user's notes and the individual commitments, decisions and questions inside them. Use this first for almost any question. Returns notes with ids you can cite.",
      schema: z.object({
        query: z.string().describe('What to look for, phrased as a statement or question'),
        limit: z.number().optional().describe('How many notes to return (default 5, max 10)'),
        intent: z
          .enum(INTENTS as [string, ...string[]])
          .optional()
          .describe('Narrow to one kind of note, e.g. only decisions or only ideas'),
      }),
    }
  );

  const openQuestionsTool = tool(
    async () => {
      const supabase = await supabaseServer();
      // Explicit constraint: questions has two FKs back to notes.
      const { data } = await supabase
        .from('questions')
        .select('text, created_at, notes!questions_note_id_fkey ( id, title )')
        .eq('user_id', userId)
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!data?.length) return 'No open questions recorded.';
      return data
        .map((q: any) => {
          if (q.notes?.id) trace.touchedNotes.add(q.notes.id);
          return `- ${q.text}  (from "${q.notes?.title ?? 'unknown'}", id=${q.notes?.id}, ${new Date(q.created_at).toDateString()})`;
        })
        .join('\n');
    },
    {
      name: 'list_open_questions',
      description:
        "Questions the user raised but never resolved. Use for 'what's unresolved', 'what am I still unsure about', 'what should I follow up on'.",
      schema: z.object({}),
    }
  );

  const decisionsTool = tool(
    async ({ about }) => {
      const supabase = await supabaseServer();
      let q = supabase
        .from('decisions')
        .select('text, alternatives, created_at, notes ( id, title )')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (about) q = q.ilike('text', `%${about}%`);

      const { data } = await q;
      if (!data?.length) return about ? `No decisions mentioning "${about}".` : 'No decisions recorded.';

      return data
        .map((d: any) => {
          if (d.notes?.id) trace.touchedNotes.add(d.notes.id);
          const alts = d.alternatives?.length ? `  (rejected: ${d.alternatives.join(', ')})` : '';
          return `- ${new Date(d.created_at).toDateString()}: ${d.text}${alts}  [id=${d.notes?.id}]`;
        })
        .join('\n');
    },
    {
      name: 'list_decisions',
      description:
        "Choices the user has settled on, newest first, with rejected alternatives. Use for 'what did I decide about X', 'why did we choose Y'.",
      schema: z.object({ about: z.string().optional().describe('Filter to decisions mentioning this') }),
    }
  );

  const dataPointsTool = tool(
    async ({ about }) => {
      const supabase = await supabaseServer();
      let q = supabase
        .from('data_points')
        .select('label, value, unit, kind, notes ( id, title )')
        .eq('user_id', userId)
        .limit(40);
      if (about) q = q.ilike('label', `%${about}%`);

      const { data } = await q;
      if (!data?.length) return 'No data points recorded.';
      return data
        .map((d: any) => {
          if (d.notes?.id) trace.touchedNotes.add(d.notes.id);
          return `- ${d.label}: ${d.value}${d.unit ? ' ' + d.unit : ''} (${d.kind})  [id=${d.notes?.id}]`;
        })
        .join('\n');
    },
    {
      name: 'list_data_points',
      description:
        "Hard facts the user recorded: numbers, dates, money, identifiers. Use for 'what were the numbers', 'when is X', 'what figures do I have'.",
      schema: z.object({ about: z.string().optional().describe('Filter by label') }),
    }
  );

  const spacesTool = tool(
    async () => {
      const spaces = await listSpaces(userId);
      if (!spaces.length) return 'No spaces yet — notes have not clustered into distinct areas.';
      return spaces.map((s) => `- ${s.name} (${s.noteCount} notes, id=${s.id})`).join('\n');
    },
    {
      name: 'list_spaces',
      description:
        "The durable areas of the user's life/work that notes are filed under. Use to orient before answering broad questions, or when the user names an area.",
      schema: z.object({}),
    }
  );

  const threadTool = tool(
    async ({ spaceName }) => {
      const spaces = await listSpaces(userId);
      const space = spaces.find((s) => s.name.toLowerCase().includes(spaceName.toLowerCase()));
      if (!space) return `No space matching "${spaceName}". Known: ${spaces.map((s) => s.name).join(', ') || 'none'}`;

      const notes = await listNotes(userId);
      const inSpace = notes
        .filter((n) => n.spaceId === space.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

      if (!inSpace.length) return `"${space.name}" has no notes yet.`;
      inSpace.forEach((n) => trace.touchedNotes.add(n.id));

      // Chronological, so "catch me up" reads as a story rather than a bag of hits.
      return `Space "${space.name}", oldest first:\n\n${inSpace
        .map((n) => `${new Date(n.createdAt).toDateString()} — ${n.title} [${n.intent}]\n  ${n.summary}\n  id=${n.id}`)
        .join('\n\n')}`;
    },
    {
      name: 'get_thread',
      description:
        "Every note in one space, in chronological order. Use for 'catch me up on X' or 'how did X evolve' — this gives narrative order, which plain search cannot.",
      schema: z.object({ spaceName: z.string().describe('Name of the space/area') }),
    }
  );

  const needsReviewTool = tool(
    async () => {
      const notes = await listNotes(userId, 'needs_review');
      if (!notes.length) return 'Nothing is waiting for review.';
      notes.forEach((n) => trace.touchedNotes.add(n.id));
      return notes
        .map(
          (n) =>
            `- "${n.title}" [${n.intent}, ${Math.round(n.intentConfidence * 100)}% confident] — ${n.unclassifiedReason ?? 'needs a human decision'}  id=${n.id}`
        )
        .join('\n');
    },
    {
      name: 'notes_needing_review',
      description:
        "Notes the classifier was not confident about, with the reason. Use when the user asks what needs sorting, or what the system was unsure about.",
      schema: z.object({}),
    }
  );

  const fileNoteTool = tool(
    async ({ noteId, intent, spaceName }) => {
      const note = await getNote(userId, noteId);
      if (!note) return `No note with id ${noteId}.`;

      let spaceId: string | null | undefined = undefined;
      if (spaceName) {
        const spaces = await listSpaces(userId);
        spaceId = spaces.find((s) => s.name.toLowerCase() === spaceName.toLowerCase())?.id ?? null;
        if (!spaceId) return `No space named "${spaceName}". Create it first or use an existing one.`;
      }

      await fileNote(userId, noteId, { intent, spaceId, status: 'filed' });

      // The correction becomes a few-shot example for future extractions.
      if (intent && intent !== note.intent) {
        await recordCorrection(userId, noteId, 'intent', note.intent, intent, note.text);
      }
      if (spaceName) {
        await recordCorrection(userId, noteId, 'space', note.spaceName ?? null, spaceName, note.text);
      }

      return `Filed "${note.title}"${intent ? ` as ${intent}` : ''}${spaceName ? ` in ${spaceName}` : ''}.`;
    },
    {
      name: 'file_note',
      description:
        'Resolve a note that needs review by setting its intent and/or space. Only call this when the user explicitly tells you how to classify something.',
      schema: z.object({
        noteId: z.string(),
        intent: z.enum(INTENTS as [string, ...string[]]).optional(),
        spaceName: z.string().optional(),
      }),
    }
  );

  const relatedNotesTool = tool(
    async ({ noteId }) => {
      const points = await allNotes();
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
      const points = await allNotes();
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
      const points = await allNotesWithVectors();
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
      const points = await allNotes();
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
      const points = await allNotes();
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

  const trainingLogTool = tool(
    async () => {
      const supabase = await supabaseServer();
      const [program, run] = await Promise.all([loadProgram(supabase), getCurrentRun(supabase, userId)]);
      if (!run) return 'No training program started yet.';
      const log = await loadLog(supabase, run.id);
      return summarizeRun(log, program, run.startDate, currentWeek(run.startDate, new Date(), program.weeks));
    },
    {
      name: 'training_log',
      description:
        "The user's workout log for their current training program: sessions done per week, every logged set with reps, load and date per exercise, load changes, and weekly bodyweight/sleep/food check-ins. Use for training questions such as 'when did I last add load to rows?', 'how many push-ups did I do last week?', 'am I gaining weight?'.",
      schema: z.object({}),
    }
  );

  return [
    searchNotesTool,
    trainingLogTool,
    relatedNotesTool,
    entityNotesTool,
    graphOverviewTool,
    listActionsTool,
    recentNotesTool,
    openQuestionsTool,
    decisionsTool,
    dataPointsTool,
    spacesTool,
    threadTool,
    needsReviewTool,
    fileNoteTool,
  ];
}
