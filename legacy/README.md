# Voice → Vector

A serverless prototype that turns voice notes into semantically searchable memory. **Zero running cost** — everything runs on free tiers.

**Flow:** Browser transcribes speech (Web Speech API) → Gemini embeds → Qdrant stores. Search a natural-language query and get back semantically related notes ranked by cosine similarity.

## Architecture

```
Browser (index.html)
    │
    ├── Web Speech API (browser-native transcription, no server call)
    │        │
    │        ▼
    │   transcript ──▶ /store ──▶ Gemini text-embedding-004 ──▶ Qdrant Cloud
    │
    └── query text ──▶ /search ──▶ Gemini text-embedding-004 ──▶ Qdrant Cloud ──▶ ranked results
```

Zero runtime dependencies. Everything is a fetch call. Whole app is static HTML + two Netlify Functions.

## Why this shape

- **Web Speech API** for transcription: browser-native, no API cost, no round trip, real-time interim results. Chrome/Edge only (fine for a demo).
- **Serverless functions** instead of a Flask backend: no server to run, no container to manage.
- **Managed Qdrant** instead of self-hosted: free 1GB tier handles this comfortably.
- **Gemini embeddings** (`text-embedding-004`, 768 dims): generous free tier at Google AI Studio, no credit card required.

**Total cost: $0.**

## Setup (~20 min, one time)

### 1. Qdrant Cloud (free)
- Sign up at [cloud.qdrant.io](https://cloud.qdrant.io) — no credit card
- Create a free 1GB cluster
- From the cluster page, copy the **Cluster URL** and generate an **API key**
- The collection is created automatically on the first `/store` call

### 2. Gemini API key (free)
- Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Sign in with a Google account, click "Create API key"
- No credit card required, no billing setup

### 3. Netlify
- Install the CLI: `npm i -g netlify-cli`
- Sign in: `netlify login`
- From the project root: `netlify init` (link to a new site)

### 4. Set environment variables
```bash
netlify env:set GEMINI_API_KEY your-gemini-key
netlify env:set QDRANT_URL https://xxxx.cloud.qdrant.io:6333
netlify env:set QDRANT_API_KEY your-qdrant-key
```

## Local dev

```bash
netlify dev
```

Opens on `http://localhost:8888` with functions mounted at `/.netlify/functions/*`.

## Deploy

```bash
netlify deploy --prod
```

Live at `https://your-site.netlify.app`.

## Endpoints

### `POST /.netlify/functions/store`
- Body: `{ text: string, tags?: string[], sentiment?: string }`
- Response: `{ id: string, message: string, timestamp: string }`

### `POST /.netlify/functions/search`
- Body: `{ query: string, limit?: number }`
- Response: `{ results: [{ id, score, text, timestamp, tags, sentiment }] }`

## Notes

- Transcription runs entirely in the browser using the Web Speech API (Chrome/Edge). Falls back to a warning message on unsupported browsers.
- Task type is set correctly on each embedding call: `RETRIEVAL_DOCUMENT` on store, `RETRIEVAL_QUERY` on search — improves match quality.
- Vectors are 768-dim (Gemini's `text-embedding-004`). If you swap the embedding model, update `VECTOR_SIZE` in `store.js` and delete-and-recreate the Qdrant collection.

## What's next

- Add server-side Whisper via Groq (free tier) as a Firefox/Safari fallback
- Add LLM tag inference before embedding (Gemini function calling)
- Add filter-by-tag on search (Qdrant payload filters)
- Store the original audio blob in Netlify Blobs for playback
