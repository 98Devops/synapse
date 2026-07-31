/**
 * Removes ONLY the demo notes this repo seeded, matched by exact text.
 * Anything the user recorded is left untouched.
 */
const BASE = process.env.SEED_BASE ?? 'http://localhost:3000';

const SEED_TEXTS = new Set(
  [
    "Had a call with Sarah at Acme about the Qdrant migration for Project Atlas. She's worried we won't hit the December deadline. I need to send her the benchmark numbers by Friday and book a follow up for Tuesday.",
    "Thinking about Project Atlas architecture again. The bottleneck is definitely the embedding step, not Qdrant itself. If we batch the Gemini calls we could cut latency by half. Worth prototyping this week.",
    "Coffee with Marcus. He's leaving Acme to start something in the developer tools space. Offered to introduce me to his co-founder Priya who apparently knows a lot about vector databases. Should follow up.",
    "Quick thought on second brain tools generally. Everyone builds search but nobody builds connection. The interesting part isn't finding the note, it's noticing that two notes you wrote three months apart are about the same thing.",
    "Retro on the Q3 launch went better than expected. The team is proud of the latency work. Sarah gave a nice shoutout to the Atlas migration crew. Morale is genuinely good right now.",
    "Worried about spreading myself too thin. Project Atlas, the Gemini prototype, and the Marcus introduction are all live at once. Need to pick one to go deep on. Probably Atlas since the December deadline is real.",
    "Read a paper on graph RAG today. The core claim is that entity-linked retrieval beats flat vector search on multi-hop questions. That maps exactly onto what I'm building with the second brain prototype.",
  ].map((t) => t.trim())
);

const { notes } = await fetch(`${BASE}/api/notes`).then((r) => r.json());

let removed = 0;
for (const note of notes) {
  if (!SEED_TEXTS.has(note.text.trim())) {
    console.log(`  KEEP   ${note.title}`);
    continue;
  }
  const res = await fetch(`${BASE}/api/notes/${note.id}`, { method: 'DELETE' });
  console.log(`  ${res.ok ? 'DELETE' : 'FAIL  '} ${note.title}`);
  if (res.ok) removed++;
}

console.log(`\nRemoved ${removed} seeded demo notes.`);
