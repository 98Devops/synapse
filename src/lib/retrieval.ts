import { embed, generateJson } from '@/lib/gemini';
import { searchNotes, type SearchOptions } from '@/lib/qdrant';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Retrieval in three stages:
 *   1. Cast wide  — vector search over notes AND facets, plus keyword search
 *   2. Fuse       — reciprocal rank fusion merges the two rankings
 *   3. Rerank     — a cheap model picks the best few from the shortlist
 *
 * Facet-level indexing is the important part. A long note averages into a mushy
 * vector; embedding each action, decision and question separately means a query
 * about a commitment matches the commitment, not the paragraph around it.
 */

export interface Retrieved {
  noteId: string;
  /** Why this surfaced — useful for explaining the answer. */
  via: string[];
  score: number;
}

/** RRF: rank-based, so scores from different systems don't need calibrating. */
const RRF_K = 60;

async function keywordSearch(userId: string, query: string, limit: number) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('search_notes_text', {
    p_user_id: userId,
    p_query: query,
    p_limit: limit,
  });
  if (error) {
    // Full-text is an enhancement; vector search alone still works.
    console.error('[retrieval] keyword search failed:', error.message);
    return [] as Array<{ id: string }>;
  }
  return (data ?? []) as Array<{ id: string; title: string; rank: number }>;
}

export async function hybridSearch(
  userId: string,
  query: string,
  opts: SearchOptions & { limit?: number; rerank?: boolean } = {}
): Promise<Retrieved[]> {
  const shortlist = 20;
  const want = opts.limit ?? 6;

  const [vector, keyword] = await Promise.all([
    embed(query, 'RETRIEVAL_QUERY').then((v) => searchNotes(v, userId, shortlist, opts)),
    keywordSearch(userId, query, shortlist),
  ]);

  const fused = new Map<string, { score: number; via: Set<string> }>();

  vector.forEach((hit, i) => {
    // Facet hits resolve back to the note that owns them.
    const noteId = (hit.payload as { parentId?: string }).parentId ?? hit.id;
    const kind = (hit.payload as { kind?: string }).kind ?? 'note';
    const entry = fused.get(noteId) ?? { score: 0, via: new Set<string>() };
    entry.score += 1 / (RRF_K + i + 1);
    entry.via.add(kind === 'note' ? 'semantic' : `semantic:${kind}`);
    fused.set(noteId, entry);
  });

  keyword.forEach((row, i) => {
    const entry = fused.get(row.id) ?? { score: 0, via: new Set<string>() };
    entry.score += 1 / (RRF_K + i + 1);
    entry.via.add('keyword');
    fused.set(row.id, entry);
  });

  const ranked = [...fused.entries()]
    .map(([noteId, v]) => ({ noteId, score: v.score, via: [...v.via] }))
    .sort((a, b) => b.score - a.score);

  if (!opts.rerank || ranked.length <= want) return ranked.slice(0, want);
  return rerank(userId, query, ranked, want);
}

const RERANK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ids: {
      type: 'ARRAY',
      description: 'Note ids, most relevant first. Omit anything irrelevant.',
      items: { type: 'STRING' },
    },
  },
  required: ['ids'],
};

/**
 * Cheaper and more accurate than simply raising k: fetch 20, let a small model
 * judge which actually answer the question, keep the best few.
 */
async function rerank(
  userId: string,
  query: string,
  candidates: Retrieved[],
  want: number
): Promise<Retrieved[]> {
  const supabase = await supabaseServer();
  const ids = candidates.slice(0, 20).map((c) => c.noteId);

  const { data } = await supabase
    .from('notes')
    .select('id, title, summary, intent')
    .eq('user_id', userId)
    .in('id', ids);

  if (!data?.length) return candidates.slice(0, want);

  const listing = data
    .map((n) => `id: ${n.id}\nintent: ${n.intent}\ntitle: ${n.title}\nsummary: ${n.summary}`)
    .join('\n---\n');

  try {
    const out = await generateJson(
      `Rank these notes by how well they answer the question. Return only ids that are genuinely relevant, best first. Return at most ${want}.\n\nQUESTION: ${query}\n\nNOTES:\n${listing}`,
      RERANK_SCHEMA
    );
    const order: string[] = out.ids ?? [];
    const byId = new Map(candidates.map((c) => [c.noteId, c]));
    const picked = order.map((id) => byId.get(id)).filter(Boolean) as Retrieved[];
    return picked.length ? picked.slice(0, want) : candidates.slice(0, want);
  } catch {
    // Reranking is an optimisation — never let it break retrieval.
    return candidates.slice(0, want);
  }
}
