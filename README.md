# Synapse

A voice-first second brain. Speak a thought; Synapse transcribes it, extracts the
people, projects and ideas inside it, embeds it, and weaves it into a living
knowledge graph you can question — and that answers you out loud.

## What it does

- **Capture** — speak or type. Transcription runs in the browser (Web Speech API), so
  there is no audio upload and no transcription cost.
- **Understand** — Gemini extracts a title, summary, sentiment, tags, action items and
  typed entities (person / project / org / concept / place / tool) from each note.
- **Connect** — notes link to entities they mention, and to each other by semantic
  similarity. The result is a force-directed graph you can explore.
- **Ask** — a LangChain agent with six tools over your own notes. It chooses its own
  path (search → follow entity edges → check actions), cites what it used, and can
  speak the answer back. Hands-free conversation mode closes the loop.
- **Notice** — automatic theme clustering, strongest hubs, orphaned notes, an activity
  pulse and an action tracker.
- **Evolve** — a pattern engine reads across everything you've said and trained and
  tells you what's rising, what's fading, the loops you keep circling and where parts
  of your life connect. Rate each highlight; it learns what you find useful.
- **Train** — the Size Blueprint training log: sets, loads, last-time targets, weekly
  check-ins and measurements, with voice logging. See `docs/specs/size-blueprint-log.md`.
- **Pocket** — installs as a PWA on your phone, opens instantly from cache, works
  offline for reading.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript |
| Transcription | Web Speech API (browser, Chrome/Edge) |
| Understanding | Gemini `gemini-3.6-flash`, structured output |
| Embeddings | Gemini `gemini-embedding-001`, 768-dim |
| Agent | LangChain v1 `createAgent`, with retry + model fallback |
| Speech out | Gemini TTS, plus instant browser synthesis |
| Vector index | Qdrant Cloud |
| Database | Supabase (Postgres, Auth, Storage) |
| Graph render | d3-force + hand-written Canvas 2D |
| Motion | Framer Motion |

Postgres is the source of truth; Qdrant is a derived index that can be rebuilt.

## Running locally

```bash
npm install
cp .env.example .env      # then fill in the values
npm run dev
```

Open http://localhost:3000.

**Voice capture needs Chrome or Edge.** Brave and most privacy browsers ship without
Google speech access and fail with a `network` error. Typing works everywhere.

### Environment

See `.env.example`. You need free accounts at
[Google AI Studio](https://aistudio.google.com/apikey),
[Qdrant Cloud](https://cloud.qdrant.io) and [Supabase](https://supabase.com/dashboard) —
none require a credit card.

### Database

In the Supabase SQL editor, run in order: `supabase/schema.sql`,
`supabase/migration-002-classification.sql`, `supabase/migration-003-training-and-highlights.sql`.
All are safe to re-run.

### Vector index

Qdrant is derived from Postgres. If the cluster is new or wiped, point `QDRANT_URL` /
`QDRANT_API_KEY` at it and run:

```bash
node scripts/reindex.mjs
```

Free Qdrant clusters are deleted after a period of inactivity; the scheduled Netlify
function `netlify/functions/keepalive.mts` pings Qdrant and Supabase daily to prevent it.

### On your phone

Open the deployed site in Chrome (Android) and choose **Install app**, or in Safari (iOS)
**Share → Add to Home Screen**. The service worker only registers in production builds.

## Notes on the design

- **Entity extraction is the point.** Flat semantic search finds a note; entity links
  let the agent answer multi-hop questions by walking between notes.
- **Semantic edges are capped** at 3 per note above 0.55 cosine. Without a cap the
  graph collapses into a hairball.
- **Gemini free-tier quota is per-model and low.** Every model call retries with
  backoff and falls down a model chain, so a burst can't kill a capture or an answer.

## Layout

```
src/
  app/
    api/         notes, graph, clusters, agent, ask, speak, export
    page.tsx     the whole shell
  components/    GraphCanvas, CapturePanel, AgentPanel, PulsePanel, …
  lib/
    agent/       LangChain agent and its tools
    gemini.ts    embeddings, extraction, streaming
    qdrant.ts    vector index
    graph.ts     graph construction and one-hop expansion
  features/
    training/    Size Blueprint training module (program, rules, UI)
supabase/
  schema.sql     tables, RLS, storage bucket
  migration-*    incremental migrations, run in order
scripts/
  reindex.mjs    rebuild Qdrant from Postgres
docs/
  specs/         feature specs
  sprints/       what each sprint shipped and why
legacy/          the original single-file prototype
```
