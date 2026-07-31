/**
 * Adopts notes recorded before auth existed.
 *
 * Qdrant points with no userId are claimed by the target account, then mirrored
 * into Postgres (notes + entities + note_entities + actions). Idempotent — rerun
 * safely; anything already in Postgres is skipped.
 *
 *   node scripts/migrate.mjs [email]
 */
import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const COLLECTION = 'synapse_notes';

const qdrantUrl = (() => {
  const u = new URL(env.QDRANT_URL);
  if (!u.port) u.port = '6333';
  return u.origin;
})();

const sb = (path, init = {}) =>
  fetch(`${SUPA}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

const qd = (path, init = {}) =>
  fetch(`${qdrantUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'api-key': env.QDRANT_API_KEY, ...(init.headers || {}) },
  });

// ---------------------------------------------------------------- find user
const wanted = process.argv[2];
const usersRes = await sb('/auth/v1/admin/users?per_page=100');
if (!usersRes.ok) {
  console.error('Could not list users:', await usersRes.text());
  process.exit(1);
}
const { users } = await usersRes.json();
if (!users?.length) {
  console.error('No accounts exist yet. Sign up at http://localhost:3000/login first.');
  process.exit(1);
}
const user = wanted ? users.find((u) => u.email === wanted) : users[0];
if (!user) {
  console.error(`No account for ${wanted}. Found: ${users.map((u) => u.email).join(', ')}`);
  process.exit(1);
}
console.log(`Target account: ${user.email}  (${user.id})\n`);

// ------------------------------------------------------- claim orphan points
const scrollAll = async () => {
  const out = [];
  let offset;
  for (let i = 0; i < 20; i++) {
    const res = await qd(`/collections/${COLLECTION}/points/scroll`, {
      method: 'POST',
      body: JSON.stringify({ limit: 256, with_payload: true, ...(offset ? { offset } : {}) }),
    });
    if (!res.ok) {
      if (res.status === 404) return out;
      throw new Error(`scroll failed: ${await res.text()}`);
    }
    const d = await res.json();
    out.push(...(d.result?.points ?? []));
    offset = d.result?.next_page_offset;
    if (!offset) break;
  }
  return out;
};

const points = await scrollAll();
const orphans = points.filter((p) => !p.payload?.userId);
const mine = points.filter((p) => p.payload?.userId === user.id);
const others = points.length - orphans.length - mine.length;

console.log(`Qdrant: ${points.length} points — ${orphans.length} unowned, ${mine.length} already yours, ${others} other accounts`);

if (orphans.length) {
  const res = await qd(`/collections/${COLLECTION}/points/payload?wait=true`, {
    method: 'POST',
    body: JSON.stringify({ payload: { userId: user.id }, points: orphans.map((p) => p.id) }),
  });
  if (!res.ok) throw new Error(`claim failed: ${await res.text()}`);
  console.log(`Claimed ${orphans.length} notes into your account.`);
}

// ---------------------------------------------------------- mirror into pg
const owned = [...mine, ...orphans];
if (!owned.length) {
  console.log('\nNothing to mirror.');
  process.exit(0);
}

const existingRes = await sb(`/rest/v1/notes?select=id&user_id=eq.${user.id}`);
const existing = new Set((await existingRes.json()).map((r) => r.id));

// Existing entities, so we reuse ids rather than duplicating.
const entRes = await sb(`/rest/v1/entities?select=id,name,type&user_id=eq.${user.id}`);
const entKey = (n, t) => `${t}:${String(n).trim().toLowerCase()}`;
const known = new Map((await entRes.json()).map((e) => [entKey(e.name, e.type), e.id]));

let mirrored = 0;
const failures = [];

for (const p of owned) {
  if (existing.has(String(p.id))) continue;
  const n = p.payload;

  const noteRes = await sb('/rest/v1/notes', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: String(p.id),
      user_id: user.id,
      title: n.title ?? '',
      text: n.text,
      summary: n.summary ?? '',
      sentiment: n.sentiment ?? 'neutral',
      tags: n.tags ?? [],
      source: n.source === 'text' ? 'text' : 'voice',
      created_at: n.createdAt ?? new Date().toISOString(),
    }),
  });
  if (!noteRes.ok) {
    failures.push(`${n.title}: ${(await noteRes.text()).slice(0, 160)}`);
    continue;
  }

  // entities
  for (const e of n.entities ?? []) {
    const k = entKey(e.name, e.type);
    if (!known.has(k)) {
      const r = await sb('/rest/v1/entities', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: user.id, name: e.name, type: e.type }),
      });
      if (r.ok) {
        const [row] = await r.json();
        known.set(k, row.id);
      }
    }
    const entityId = known.get(k);
    if (entityId) {
      await sb('/rest/v1/note_entities', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ note_id: String(p.id), entity_id: entityId }),
      });
    }
  }

  // actions, preserving anything already ticked off
  const done = new Set(n.completedActions ?? []);
  for (const text of n.actionItems ?? []) {
    await sb('/rest/v1/actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        note_id: String(p.id),
        user_id: user.id,
        text,
        done: done.has(text),
        done_at: done.has(text) ? new Date().toISOString() : null,
      }),
    });
  }

  mirrored++;
  console.log(`  mirrored: ${n.title}`);
}

console.log(`\nDone. ${mirrored} notes mirrored into Postgres, ${existing.size} already present.`);
if (failures.length) {
  console.log('Failures:');
  failures.forEach((f) => console.log('  ' + f));
}
