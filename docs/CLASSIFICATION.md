# Classification & information architecture

How a raw voice note becomes structured, findable knowledge — and what happens
when it can't be.

---

## The core idea

A voice note is **not one thing**. "Had a call with Sarah, she's worried about
December, I need to send the benchmarks by Friday, and I think we should batch the
Gemini calls" is simultaneously a log, a concern, a commitment and an idea.

So Synapse does not put a note in a box. It classifies along **three independent
axes**, and extracts **facets** that can each stand alone.

```
                    ┌── intent ──────► what the speaker was doing
  voice note ───────┼── facets ──────► the extractable pieces inside it
                    └── placement ───► where it lives (space / thread)
```

---

## Axis 1 — Intent (what the speaker was *doing*)

One primary intent per note, with a confidence score.

| Intent | The speaker is… | Example |
|---|---|---|
| `task` | committing to do something | "I need to send her the benchmarks by Friday" |
| `decision` | recording a choice made | "We're going with Qdrant, not pgvector" |
| `idea` | proposing something new | "What if we batched the embedding calls" |
| `question` | raising something unresolved | "Do we even need a separate index?" |
| `observation` | noting a fact about the world | "Their API returns 429s above 5 rpm" |
| `reflection` | processing their own state | "I'm spreading myself too thin" |
| `reference` | capturing external material | "The paper is arXiv 2404.16130" |
| `log` | routine record of what happened | "Standup done, everyone's unblocked" |
| `unclassified` | genuinely ambiguous or too thin | "Yeah… okay. Hmm." |

**Confidence is mandatory.** Below `0.6` the note is flagged **Needs review** rather
than silently mis-filed. A second-brain that quietly puts things in the wrong drawer
is worse than one that admits uncertainty.

### What is deliberately *not* classifiable

- **Too short / no content** — "testing testing", "hello" → `unclassified`, held in Inbox
- **Pure filler** — no proposition, no commitment, no fact
- **Multi-intent with no dominant** — flagged, user picks
- **Failed transcription** — low STT confidence never reaches classification

These are **not errors**. They go to the Inbox with a reason attached, and the user
can classify manually, merge them into another note, or discard. Nothing is thrown
away silently.

---

## Axis 2 — Facets (the pieces inside)

Extracted independently of intent, because one note can carry several. Each becomes
a first-class row, queryable on its own.

| Facet | Table | What it captures |
|---|---|---|
| **Action** | `actions` | A commitment, with owner and due date if stated |
| **Data point** | `data_points` | A number, date, metric, identifier, or hard fact |
| **Question** | `questions` | Something raised and unresolved, with a resolved flag |
| **Entity** | `entities` | Person, project, org, concept, place, tool |
| **Decision** | `decisions` | A choice, with the alternatives rejected if mentioned |
| **Connection** | graph edges | Explicit ("X relates to Y") or inferred by similarity |

The point: **"send the benchmarks by Friday" is retrievable as an action even
though the note's intent was `log`.** Facets are why a single note can answer
several different questions.

---

## Axis 3 — Placement (where it lives)

Two levels. Both auto-derived, both user-overridable.

```
Space  ── a durable area of your life or work
  └── Thread  ── a running conversation about one subject over time
        └── Note
```

**Space** — derived from the dominant project/org entity across a note's history.
"Project Atlas", "Interview prep", "Granite". A note with no clear space stays in
**Inbox**. Spaces are renamable and mergeable.

**Thread** — a chain of notes about the same subject. A new note joins an existing
thread when it shares the dominant entity *and* is semantically close to the
thread's centroid (cosine ≥ 0.7). Otherwise it starts a new one. This is what makes
"catch me up on Atlas" answerable chronologically rather than as a bag of hits.

**Placement is a suggestion, not a verdict.** Every note shows its assigned space
with a confidence, and one click moves it.

---

## Lifecycle

```
captured ──► transcribed ──► classified ──┬──► filed      (confidence ≥ 0.6)
                                          └──► needs_review (below, or ambiguous)
                                                   │
                                              user resolves
                                                   ▼
                                                 filed ──► archived
```

**The Inbox is the answer to "where does my note go before it's classified".**
Every note is visible there from the moment it's transcribed, with its raw
transcript, its proposed classification, and the confidence behind it. Nothing is
invisible while processing, and nothing is auto-filed without being reviewable.

---

## How the agent uses this

The classification is not decoration — it changes what the agent can do.

| Question | Without classification | With it |
|---|---|---|
| "What do I owe people?" | vector search for "owe", hope | `actions where done=false`, exact |
| "What did I decide about Atlas?" | keyword luck | `decisions where space=Atlas`, chronological |
| "What's unresolved?" | impossible | `questions where resolved=false` |
| "Catch me up on Granite" | ranked bag of notes | thread walked in order |
| "What numbers do I know?" | impossible | `data_points`, typed |

New agent tools this unlocks: `list_open_questions`, `list_decisions`,
`get_thread`, `list_data_points`, `notes_needing_review`, `file_note`.

---

## Retrieval design (why the vector store is shaped this way)

Retrieval quality is a function of what you embed, not just how you search.

1. **Embed facets, not just notes.** A long note dilutes into an average vector.
   Each action, decision and question gets its own embedding pointing back at its
   parent note. A query about a commitment then matches the commitment, not the
   ten sentences around it.

2. **Hybrid search.** Vectors miss exact tokens — names, error codes, dates.
   Postgres full-text runs alongside vector search; results merge by reciprocal
   rank fusion.

3. **Filter before you rank.** Qdrant payload indexes on `userId`, `space_id`,
   `intent`, `created_at` mean "decisions about Atlas since June" narrows the
   candidate set *before* the ANN search.

4. **Rerank the shortlist.** Retrieve ~20, have a cheap model rerank to the best 5.
   Cheaper and better than raising `k` and hoping.

5. **Walk the graph after retrieving.** Vector hits are seeds; entity edges expand
   them. This is the multi-hop step flat RAG cannot do.

---

## Self-learning

The system should get better at *this user* over time, without training a model.

- **Correction memory.** Every manual reclassification is stored. Those corrections
  become few-shot examples in the extraction prompt — so if you keep re-filing
  "standup" notes from `log` to `task`, it learns.
- **Entity canon.** Confirmed merges ("Sarah" = "Sarah Chen") persist and are fed
  to the extractor, so it stops splitting them.
- **Vocabulary profile.** Recurring domain terms are collected and passed as
  context, improving both transcription and extraction of jargon.
- **Retrieval feedback.** Citations the user clicks, and answers they rate, adjust
  the ranking blend over time.

None of this requires fine-tuning. It's prompt context plus stored preferences —
cheap, inspectable, and reversible.
