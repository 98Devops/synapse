# Synapse — system brief

A single self-contained description of the product, its architecture, and where it
could go next. Written to be pasted into a new conversation, a design doc, or a
pitch without further context.

---

## The one-liner

**Synapse is a voice-first second brain.** You speak a thought; it transcribes it,
extracts the people, projects and ideas inside it, embeds it, and weaves it into a
living knowledge graph you can question out loud — and that answers you out loud.

## The problem it exists for

Note tools solve *capture* and *search*. Neither is the hard part.

The hard part is **connection**: noticing that a worry you voiced in March is the
same worry as a decision you made in July, that two clients share a blocker, that a
name keeps recurring across unrelated projects. Search finds the note you already
know you want. It cannot tell you what you'd forgotten to look for.

Synapse is built on the bet that **entity-linked retrieval beats flat vector
search** for that job. Notes link to the named things inside them and to each other
by meaning, so an AI agent can walk between them — multi-hop — instead of returning
a ranked list.

Voice is the input because the friction of typing is what stops people capturing
thoughts in the first place.

---

## Architecture

```
  Browser (any: Chrome, Brave, Firefox, Safari)
      │
      │  MediaRecorder captures audio
      ▼
  POST /api/transcribe ──► ElevenLabs Scribe  (fallback: Gemini)
      │                └─► private audio bucket (Supabase Storage)
      ▼  transcript
  POST /api/notes
      │
      ├─► Gemini structured extraction ─┐  (concurrent)
      └─► Gemini embedding, 768-dim ────┘
      │
      ├─► Postgres   (source of truth: notes, entities, actions)
      └─► Qdrant     (derived index: vector + payload, filtered by user_id)
      │
      ▼
  GET /api/graph ──► nodes = notes + entities
                     edges = "mentions" (extracted) + "similar" (cosine ≥ 0.55, capped at 3/note)
      │
      ▼
  Canvas force-directed renderer (d3-force + hand-written Canvas 2D)

  POST /api/agent ──► LangChain agent, 6 tools over the user's own notes
      │               streams NDJSON: tool steps, tokens, citations
      ▼
  POST /api/speak ──► ElevenLabs Flash v2.5 (fallback: Gemini TTS, then browser)
```

**Postgres is the source of truth; Qdrant is a rebuildable index.** Writes go to
Postgres first — if it rejects, nothing lands in the vector store, so the two
cannot drift.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript, React 19 | Route handlers stream natively; one deployable |
| Styling | Tailwind v4 with CSS custom properties | Every colour is a token, so light/dark are both first-class |
| Motion | Framer Motion | Layout animations, spring transitions |
| Graph render | `d3-force` + hand-written Canvas 2D | Full control over glow, particles, camera; no heavy dependency |
| Transcription | **ElevenLabs Scribe** (`scribe_v1`), fallback Gemini | ~1.3s, works in every browser |
| Understanding | **Gemini `gemini-3.1-flash-lite`**, structured output | ~1.4s, same extraction quality as the larger model |
| Embeddings | **Gemini `gemini-embedding-001`**, truncated to 768-dim | Free tier, no local model, no torch |
| Agent | **LangChain v1** `createAgent` + retry/fallback middleware | Chooses its own tool path; survives rate limits |
| Speech out | **ElevenLabs `eleven_flash_v2_5`**, fallback Gemini TTS, then browser | ~380ms to first audio byte |
| Vector index | **Qdrant Cloud** | Purpose-built ANN; payload filter for tenant isolation |
| Database | **Supabase** (Postgres + Auth + Storage) | One signup covers data, identity and audio |
| Hosting | Netlify | Static shell + serverless route handlers |

All services run on free tiers with no credit card.

---

## Data model

```
profiles        id → auth.users, email, display_name
notes           id, user_id, title, text, summary, sentiment,
                tags[], source, audio_path, created_at
entities        id, user_id, name, type          -- unique per (user, lower(name), type)
note_entities   note_id, entity_id               -- many-to-many
actions         id, note_id, user_id, text, done, done_at
conversations   id, user_id, query, answer, citations, tools_used, created_at
storage         recordings/<user_id>/<uuid>.webm  (private bucket)
```

**Row Level Security is enabled on every table**, keyed to `auth.uid()`. Qdrant
carries a `userId` payload field with a keyword index, and every search and scroll
is filtered by it. Isolation is enforced twice, independently.

Entity types: `person | project | org | concept | place | tool`
Sentiments: `positive | neutral | negative | urgent`

---

## What exists today

**Capture** — record in any browser, or type. Live waveform, timer, cancel.
Original audio is kept privately.

**Understanding** — every note yields a title, one-line summary, sentiment, tags,
action items, and typed entities.

**Graph** — notes and entities as nodes; entity-mention edges and capped semantic
edges. Three layouts (constellation / timeline / radial), zoom-to-cursor, node
dragging, hover halos, travelling edge pulses.

**Themes** — label-propagation community detection, each cluster named by one
batched LLM call, drawn as soft convex hulls behind the nodes.

**Agent** — LangChain agent with six tools: `search_notes`, `related_notes`,
`entity_notes`, `graph_overview`, `list_action_items`, `recent_notes`. Streams its
reasoning steps live, cites the notes it used, highlights them in the graph.

**Voice reply** — instant browser speech, or natural ElevenLabs. Hands-free
conversation mode: speak → answer → spoken reply → listens again.

**Pulse** — 14-day activity sparkline, mood mix, strongest hubs, orphaned notes
(nothing links them yet), aggregated action tracker.

**Craft** — command palette (⌘K) with fuzzy subsequence matching, lens filters,
light/dark themes with no flash on load, mobile tab-bar shell, JSON/Markdown export,
keyboard shortcuts.

### Measured latency

| Path | Time |
|---|---|
| Capture → stored in graph | ~4.7s |
| Agent → first token | ~5.4s |
| Voice reply → first audio | ~0.38s |
| Full spoken conversational turn | **~5.5s** |

(Down from ~22s: the wins were caching per-request Qdrant reads, switching to
flash-lite, parallelising extraction and embedding, and fixing a silent TTS
fallback.)

---

## Known gaps

- **No billing or plan limits** — the SaaS shell exists (auth, isolation), the
  commercial layer does not.
- **Conversations are not notes.** Valuable thinking happens in agent chats and
  currently dies there.
- **Graph rebuilds fully on every load.** Fine to a few hundred notes; needs
  incremental updates beyond that.
- **Email confirmation is disabled** for development convenience. Must be re-enabled
  with real SMTP before public signups.
- **Entity resolution is exact-match on lowercase name.** "Sarah" and "Sarah Chen"
  remain separate nodes.

---

## Possible features

**Deepen the graph**
- Entity merging and aliasing, with a suggested-duplicates review
- Typed relationships between entities ("Sarah *works at* Acme") rather than only
  co-mention
- Temporal edges — what changed about a project between two notes
- Contradiction detection: surface where a new note conflicts with an older one

**Make the agent proactive**
- Daily or weekly digest: what you committed to, what went quiet, what recurred
- Resurfacing: "you wrote something similar three months ago"
- Nudges on orphaned notes and stale action items
- Scheduled agent runs that write their findings back as notes

**Close the capture loop**
- Save an agent conversation as a note, so reasoning enters the graph
- Audio playback on every note, aligned to the transcript
- Import from Obsidian, Notion, Apple Notes, or plain Markdown
- Browser extension and share-target for capturing links and quotes
- Real-time streaming transcription for live interim text

**Collaboration**
- Shared brains for a team, with per-note visibility
- Mentions that notify, and a shared entity space
- Public read-only graph links

**Product and platform**
- Billing with plan limits (Stripe), usage metering per model call
- Mobile app or installable PWA with offline capture and background sync
- Per-user API keys, so heavy users pay their own model costs
- Self-hosted deployment (Docker Compose: app + Qdrant + Postgres)
- End-to-end encryption for note text, with embeddings computed client-side

**Intelligence**
- Reranking retrieved notes before the agent sees them
- Hybrid search: keyword (BM25) alongside vectors
- Multi-modal capture — photos and screenshots with vision extraction
- Multilingual capture and cross-lingual retrieval
- Fine-tuned or few-shot extraction adapted to the individual's vocabulary

---

## Guiding principles

1. **Connection over retrieval.** Search is a means; noticing is the product.
2. **Voice first, but never voice only.** Typing must always work.
3. **Never lose the note.** Audio upload can fail; the transcript cannot.
4. **Degrade, don't break.** Every model call retries and falls back — rate limits
   must never cost a user their thought.
5. **Isolation at the database, not in application code.** RLS is the boundary;
   a forgotten `where` clause must not become a data leak.
