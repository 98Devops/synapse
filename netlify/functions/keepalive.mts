/**
 * Daily keep-alive.
 *
 * Free tiers reclaim idle resources: Qdrant Cloud suspends an unused free
 * cluster and later deletes it (which is how the first one was lost), and
 * Supabase pauses a project after a week without traffic. One cheap read
 * against each per day counts as activity for both.
 */
export default async function keepalive() {
  const results: Record<string, number | string> = {};

  const qdrant = process.env.QDRANT_URL;
  if (qdrant) {
    const u = new URL(qdrant);
    if (!u.port) u.port = '6333';
    results.qdrant = await fetch(`${u.origin}/collections/synapse_notes`, {
      headers: { 'api-key': process.env.QDRANT_API_KEY ?? '' },
    })
      .then((r) => r.status)
      .catch((e: Error) => e.message);
  }

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabase && key) {
    results.supabase = await fetch(`${supabase}/rest/v1/programs?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
      .then((r) => r.status)
      .catch((e: Error) => e.message);
  }

  console.log('[keepalive]', JSON.stringify(results));
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { schedule: '@daily' };
