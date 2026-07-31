// POST /.netlify/functions/store
// Body: { text: string, tags?: string[], sentiment?: string }
// Response: { id, message, timestamp }

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_KEY = process.env.QDRANT_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const COLLECTION = 'voice_notes';
const VECTOR_SIZE = 768; // gemini-embedding-001, truncated to 768 dims
const EMBED_MODEL = 'gemini-embedding-001';

async function ensureCollection() {
  const check = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    headers: { 'api-key': QDRANT_KEY }
  });
  if (check.status === 200) return;

  await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'api-key': QDRANT_KEY
    },
    body: JSON.stringify({
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
    })
  });
}

async function embed(text, taskType = 'RETRIEVAL_DOCUMENT') {
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
    const { text, tags = [], sentiment = 'neutral' } = await req.json();
    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'text (string) is required' }, { status: 400 });
    }

    await ensureCollection();
    const vector = await embed(text, 'RETRIEVAL_DOCUMENT');
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const upsertRes = await fetch(
      `${QDRANT_URL}/collections/${COLLECTION}/points?wait=true`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'api-key': QDRANT_KEY
        },
        body: JSON.stringify({
          points: [{
            id,
            vector,
            payload: { text, tags, sentiment, timestamp, source: 'voice' }
          }]
        })
      }
    );

    if (!upsertRes.ok) {
      const err = await upsertRes.text();
      return Response.json({ error: `Qdrant upsert failed: ${err}` }, { status: 502 });
    }

    return Response.json({ id, message: 'Stored', timestamp });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
