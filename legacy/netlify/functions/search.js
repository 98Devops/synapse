// POST /.netlify/functions/search
// Body: { query: string, limit?: number }
// Response: { results: [{ id, score, text, timestamp, tags, sentiment }] }

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_KEY = process.env.QDRANT_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const COLLECTION = 'voice_notes';
const VECTOR_SIZE = 768; // must match store.js
const EMBED_MODEL = 'gemini-embedding-001';

async function embed(text, taskType = 'RETRIEVAL_QUERY') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: VECTOR_SIZE
    })
  });
  if (!res.ok) throw new Error(`Gemini embedding error: ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { query, limit = 5 } = await req.json();
    if (!query || typeof query !== 'string') {
      return Response.json({ error: 'query (string) is required' }, { status: 400 });
    }

    const vector = await embed(query, 'RETRIEVAL_QUERY');

    const searchRes = await fetch(
      `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': QDRANT_KEY
        },
        body: JSON.stringify({
          vector,
          limit,
          with_payload: true
        })
      }
    );

    if (!searchRes.ok) {
      // Collection likely doesn't exist yet — return empty rather than 500
      if (searchRes.status === 404) {
        return Response.json({ results: [] });
      }
      const err = await searchRes.text();
      return Response.json({ error: `Qdrant search failed: ${err}` }, { status: 502 });
    }

    const data = await searchRes.json();
    const results = (data.result || []).map(hit => ({
      id: hit.id,
      score: hit.score,
      text: hit.payload?.text || '',
      timestamp: hit.payload?.timestamp,
      tags: hit.payload?.tags || [],
      sentiment: hit.payload?.sentiment
    }));

    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
