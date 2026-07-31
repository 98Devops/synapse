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

Paste `supabase/schema.sql` into the Supabase SQL editor and run it. It creates the
tables, row level security policies, and the private `recordings` storage bucket.

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
supabase/
  schema.sql     tables, RLS, storage bucket
legacy/          the original single-file prototype
```
