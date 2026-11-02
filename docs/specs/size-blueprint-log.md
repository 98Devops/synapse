# Size Blueprint Log Integration Spec

Nov 2, 2026 · @Tafara

## Context

The Size Blueprint Log tracks a 12-week home muscle-building program for one person and tells him, set by set, what number to beat next session. This spec explains what it does and how it decides, so it can move into the Second Brain app as a module without losing its rules or its data.

**Who uses it.** Tafara, training at home with bodyweight and a loaded backpack until he has gym access. He started on 2026-10-20 at 50 kg. The goal is to look wider and bigger by adding muscle, gaining about 0.25 kg a week (roughly 53 kg by week 12).

**What it does today.**

- Shows one training week at a time, with the three sessions in the right A/B order for that week.
- Records reps for every set and the backpack load for every exercise.
- Shows last session's numbers as the target to beat, and flags when it is time to add load.
- Holds a weekly check-in for bodyweight, sleep, food and notes, and compares bodyweight with the week 1 value against the gain target.
- Opens a measurements panel (waist, chest, upper arm, thigh, photos) in weeks 1, 4, 8 and 12.
- Opens on the current week, worked out from the program start date.

**Where it lives now.** A private claude.ai artifact, [Size Blueprint Log](https://claude.ai/artifact/RqyJNcvxWn1xQUHGdKTRTU), one HTML page whose entries save to a per-user store on his claude.ai account.

**Scope of the rebuild.** Keep every behaviour above. Phase 1 is this home program. Phase 2 (gym) will bring a different exercise list, so the program must be data, not code (see Known gaps).

## The program it encodes

The app runs two workouts, A and B, three sessions a week for 12 weeks. Odd weeks run A, B, A and even weeks run B, A, B, so each workout gets 18 sessions in total. There is at least one rest day between sessions.

**Format.** Exercises are done in supersets: exercise 1, then exercise 2 straight after, then 2–3 minutes of rest, repeated for every set. In a superset that includes a one-leg exercise, the user does both legs before moving to the partner exercise. Most sets stop with 1–2 good reps left, and the last set can go close to failure.

**Workout A**

| Code | Exercise | Key | Sets | Reps | Note |
| --- | --- | --- | --- | --- | --- |
| A1 | Backpack push-ups | `pushups` | 3 | 8–15 |  |
| A2 | Table rows | `tablerows` | 3 | 8–15 |  |
| B1 | Bulgarian split squats | `bss` | 3 | 8–12 | per leg |
| B2 | Lateral raises | `lateral` | 3 | 12–20 |  |
| C1 | Chair dips | `dips` | 2 | 8–15 |  |
| C2 | Bicep curls | `curls` | 2 | 10–15 |  |

**Workout B**

| Code | Exercise | Key | Sets | Reps | Note |
| --- | --- | --- | --- | --- | --- |
| A1 | Pike push-ups | `pike` | 3 | 6–12 |  |
| A2 | Sliding pull-ups / towel rows | `pullups` | 3 | 8–12 |  |
| B1 | Romanian deadlifts | `rdl` | 3 | 10–15 |  |
| B2 | Lateral raises | `lateral` | 3 | 12–20 |  |
| C1 | Feet-elevated push-ups | `fepush` | 2 | 8–15 |  |
| C2 | Door face pulls | `facepull` | 2 | 12–20 |  |
| D1 | Overhead triceps extensions | `ohext` | 2 | 8–15 |  |
| D2 | Bicep curls | `curls` | 2 | 10–15 |  |

`lateral` and `curls` appear in both workouts with the same key on purpose. Their history is shared, so the last-time target for curls in Workout B comes from Workout A if that was the most recent session.

**Progression order** (shown to the user as guidance):

1. Add reps until every set reaches the top of the range.
2. Add load to the backpack and drop back to the bottom of the range.
3. Slow the lowering phase to 3 seconds.
4. Move to a harder variation.

## Current data model

The log stores one JSON document per training week plus one settings document, all in a collection private to the signed-in user. Every value the user types is stored as a **string**, exactly as entered, and an empty field is `""`.

**Storage.** Collection `data/users/<userId>`. Document ids: `meta` and `w01` to `w12`. A copy of everything also goes to browser `localStorage` under the key `sbl` as `{weeks, meta}`, used when the account store is unavailable.

**`meta` document**

```json
{ "start": "2026-10-20" }
```

**Week document (`w01` … `w12`)**

```json
{
  "weight": "50",
  "sleep": "7.5",
  "food": "Same as last week",
  "notes": "Energy good",
  "m": { "waist": "68", "chest": "84", "arm": "26", "thigh": "45", "photos": true },
  "s": [
    { "date": "2026-10-20", "done": true,
      "ex": { "pushups": { "r": ["12", "10", "9"], "load": "2" },
              "tablerows": { "r": ["10", "9", "8"], "load": "" } } },
    { "ex": {} },
    { "ex": {} }
  ]
}
```

The sample values above are illustrative, not the user's data.

| Field | Type as stored | Meaning |
| --- | --- | --- |
| `meta.start` | ISO date string | Program start date; drives the current week |
| `weight` | numeric string, kg | Weekly bodyweight, taken in the morning before eating |
| `sleep` | numeric string, hours | Average sleep that week |
| `food` | one of `""`, `Same as last week`, `Added ~300 kcal/day`, `Missed meals` | Food change that week |
| `notes` | free text | Energy, soreness, anything else |
| `m.waist` `m.chest` `m.arm` `m.thigh` | numeric string, cm | Measurements, only in weeks 1, 4, 8, 12 |
| `m.photos` | boolean | Front, side and back photos taken |
| `s[i]` | object, i = 0, 1, 2 | Session i of the week; which workout it is comes from the week number, not the document |
| `s[i].date` | ISO date string | Day the session was done |
| `s[i].done` | boolean | Session marked complete |
| `s[i].ex.<key>.r[j]` | numeric string | Reps in set j (0-based) of that exercise |
| `s[i].ex.<key>.load` | numeric string, kg | Backpack load for that exercise in that session |

Two things the model does **not** store: which workout a session is (A or B is derived from the week), and the program itself (exercises, sets and ranges live in page code).

## Logic and rules

Seven rules make the log useful; the rebuild must reproduce each one exactly, ideally as pure functions with unit tests.

**1. Current week.** With a start date, the app opens on that week; without one, on week 1. The user can step between weeks 1 and 12.

```js
const days = (Date.now() - new Date(start + "T00:00:00")) / 864e5;
const week = Math.min(12, Math.max(1, Math.floor(days / 7) + 1));
```

**2. Session order.** Workout letters are derived, never stored.

```js
const order = w => (w % 2 === 1) ? ["A", "B", "A"] : ["B", "A", "B"];
```

**3. Last time (the target to beat).** For a given week, session and exercise key, search backwards: earlier sessions in the same week first, then sessions 2, 1, 0 of each earlier week. Return the first entry with at least one non-empty rep. Its reps fill each set box as grey placeholder text, and a line reads `Last time: 12 · 10 · 9 with 2 kg` (missing sets show `–`). Shared keys (`lateral`, `curls`) match across workouts.

```js
function lastTime(w, si, key) {
  for (let ww = w; ww >= 1; ww--) {
    const start = ww === w ? si - 1 : 2;
    for (let s = start; s >= 0; s--) {
      const e = weeks[ww]?.s?.[s]?.ex?.[key];
      if (e?.r?.some(v => v !== "" && v != null)) return e;
    }
  }
  return null;
}
```

**4. Add-load prompt.** When every planned set of an exercise is filled and each one is at or above the top of its rep range, show “Top of range on every set. Add load next time.” It updates live as reps are typed.

```js
const r = (entry?.r ?? []).slice(0, ex.sets).map(v => v === "" ? null : Number(v));
const addLoad = r.length === ex.sets && r.every(v => v != null && v >= ex.hi);
```

**5. Weight trend.** The baseline is the first week with a weight entered. For a later week with a weight, compare the average weekly change with 0.25 kg.

```js
const diff = cur - base.weight;
const perWeek = diff / (week - base.week);
// perWeek >= 0.25 -> "On track" (green)
// otherwise       -> "Below the 0.25 kg/week target, so add about 300 calories a day." (amber)
```

The text shows the total change since the baseline week and the per-week rate, to one and two decimals.

**6. Measurement weeks.** The measurements panel shows only in weeks 1, 4, 8 and 12. In weeks 4, 8 and 12 the week 1 values appear as grey placeholders for comparison.

**7. Saving.** Every edit updates in-memory state at once, then writes the whole week document 700 ms after the last keystroke (debounced per document). Writes to one document run one at a time, in order. While a document has unsaved edits, incoming copies of it from the server are ignored, so typing is never overwritten. Incoming changes re-render the page only when no input is focused. On first load, if the account store is empty and the browser holds local data, the local data is uploaded. If the account store is unavailable, data stays in `localStorage` only and the status line says so.

Ticking **Done** on a session sets `s[i].done` and highlights the session card.

## Integrating into the Second Brain app

Build the log as a self-contained training module inside the Second Brain app (Synapse, Next.js): program as data, rules as pure functions, entries in relational tables scoped to the user. This keeps Phase 2 (gym) a data change, not a rewrite.

**Module layout**

- `features/training/program.ts`: the Size Blueprint program as data (the two tables above). Later programs are added the same way.
- `features/training/rules.ts`: `currentWeek`, `sessionOrder`, `lastTime`, `addLoadDue`, `weightTrend`, `isMeasurementWeek`. Pure functions, shared by client and server, unit-tested.
- `features/training/api/`: route handlers or server actions for reads and writes.
- `features/training/components/`: week stepper, check-in card, session card, measurement panel.
- Route: `/training`, opening on the current week; `/training/week/[n]` for a specific week.

**Proposed tables** (Postgres; plain SQL, Prisma or Supabase all fit). Store numbers as numbers and empty fields as `NULL`.

| Table | Columns | Notes |
| --- | --- | --- |
| `programs` | id, name, weeks, created\_at | One row: “Size Blueprint Phase 1”, 12 weeks |
| `program_exercises` | program\_id, workout (`A`/`B`), code, key, name, sets, rep\_lo, rep\_hi, note, sort | Seeded from the program tables |
| `program_runs` | id, user\_id, program\_id, start\_date | One per time the user starts a program |
| `sessions` | id, run\_id, week, slot (0–2), workout, date, done | Unique (run\_id, week, slot); workout stored for easy queries but always equal to `sessionOrder(week)[slot]` |
| `exercise_entries` | id, session\_id, exercise\_key, load\_kg | Unique (session\_id, exercise\_key) |
| `sets` | entry\_id, set\_index, reps | Unique (entry\_id, set\_index) |
| `weekly_checkins` | run\_id, week, weight\_kg, sleep\_h, food, notes | Unique (run\_id, week); food is an enum of the three options |
| `measurements` | run\_id, week, waist\_cm, chest\_cm, arm\_cm, thigh\_cm, photos | Unique (run\_id, week); weeks 1, 4, 8, 12 |

Every row belongs to one user through `program_runs.user_id`. If the app uses Supabase, enforce that with row-level security.

**API**

| Call | Returns or does |
| --- | --- |
| `GET /api/training/run` | Current run, start date, current week |
| `GET /api/training/week/:n` | That week's plan, entries, check-in, measurements, plus `lastTime` and `addLoadDue` per exercise and the weight trend |
| `PUT /api/training/set` | Upsert one set's reps (session, key, set index) |
| `PUT /api/training/entry` | Upsert an exercise's load |
| `PUT /api/training/session` | Upsert date and done |
| `PUT /api/training/checkin` | Upsert the weekly check-in |
| `PUT /api/training/measurement` | Upsert measurements |

Small upserts per field replace the current whole-document writes, which removes the debounce-and-overwrite risk. Keep optimistic UI updates and a visible save status.

**Hooks into the rest of the Second Brain** (optional, after the core module works):

- **Voice logging.** “Push-ups 12, 10, 9 with 2 kilos” parsed by the AI layer into set and load upserts, shown for confirmation before saving.
- **Weekly note.** At the end of each week, generate a note in the knowledge base summarising sessions done, rep and load changes, and the weight trend, linked to that week.
- **Ask your log.** Let the assistant answer questions such as “when did I last add load to rows?” from the training tables.

## Migrating existing data

Existing entries must be carried over before the user switches apps, so no session history or targets are lost. As of this spec, the account store holds the start date (2026-10-20) and the week 1 weight (50 kg); sets logged since may also sit in the browser's `localStorage` on the device he trains with.

1. **Export.** Ask Claude to export the artifact's `data/users/me` collection as JSON, one file per document. Also export `localStorage['sbl']` from the training device (browser console: `copy(localStorage.getItem('sbl'))`).
2. **Merge.** Where a week exists in both, take the account copy unless the local one has more filled fields.
3. **Create the run.** Insert one `program_runs` row with `start_date = meta.start`.
4. **Transform each week document.** For each `wNN`:
   1. `weight`, `sleep`, `food`, `notes` → one `weekly_checkins` row.
   2. `m` → one `measurements` row, only if any field is filled.
   3. Each `s[i]` → one `sessions` row with `week = NN`, `slot = i`, `workout = sessionOrder(NN)[i]`.
   4. Each `s[i].ex[key]` → one `exercise_entries` row with `load_kg`, and one `sets` row per non-empty `r[j]`.
5. **Convert values.** Empty string → `NULL`; numeric strings → numbers; keep the keys exactly as listed in the program tables.
6. **Verify.** For three sample weeks, the new `/training/week/:n` view must show the same reps, loads, last-time targets and weight trend as the old page.
7. **Freeze the old log.** Stop entering data in the artifact once the import is verified.

## Known gaps and recommended improvements

The current log works for week-to-week use but has eight gaps worth fixing in the rebuild; the first three change what the user is told, so do them first.

| # | Gap today | Why it matters | Recommendation |
| --- | --- | --- | --- |
| 1 | Weight target fixed at 0.25 kg/week | The plan's target is 0.25–0.5% of bodyweight a week, which rises as he gains | Compute the target band from current weight: 0.0025–0.005 × weight |
| 2 | Trend uses the average since week 1 | A strong early month hides a later stall; the plan's rule is “flat for 2 weeks, add \~300 kcal/day” | Add a stall check: no gain over the last two weekly weigh-ins triggers the +300 kcal prompt |
| 3 | Split squats record one rep count per set | Legs can drift unevenly without anyone noticing | Store left and right reps for one-leg exercises, or record the weaker leg and label it |
| 4 | Program lives in page code | Phase 2 (gym) needs new exercises and ranges | Move to `programs` / `program_exercises` (see integration) |
| 5 | Values stored as unvalidated strings | Typos such as `120` reps or `-2` kg break targets | Numeric types, ranges checked (reps 0–100, load 0–60 kg, weight 30–150 kg) |
| 6 | No history views | Progress is the main motivator and is hard to see week by week | Add a weight line chart, per-exercise reps and load over 12 weeks, and a measurement comparison against week 1 |
| 7 | Only the rep step of progression is prompted | After adding load there is no reminder to drop to the bottom of the range, and tempo or variation changes are not recorded | Add a `variation` text field per entry and a prompt after a load increase |
| 8 | Week counter uses device time and stops at week 12 | Late-night sessions can land in the wrong week; there is no end state | Compute in the user's time zone (Africa/Harare); show “Program complete” after week 12 with a start-next-program action |

**Nice to have:** a 2–3 minute rest timer between supersets, a daily nutrition checklist (Shake A, Shake B, eggs, creatine), and photo uploads for the 4-week checks.

## Acceptance checklist

The module is done when every item below passes on a phone-width screen.

- [ ] With start date 2026-10-20, the module opens on the right week for today's date, and on week 1 when no start date is set.
- [ ] Week 1 shows sessions A, B, A; week 2 shows B, A, B.
- [ ] Every exercise shows its code, name, sets × rep range and note exactly as in the program tables.
- [ ] After logging push-ups 12, 10, 9 at 2 kg in session 1, session 3 of the same week shows those numbers as grey placeholders and as “Last time: 12 · 10 · 9 with 2 kg”.
- [ ] Curls logged in Workout A appear as the last-time target in the next Workout B.
- [ ] Typing 15, 15, 15 for push-ups shows the add-load prompt; changing any set to 14 hides it.
- [ ] Week 1 weight 50 and week 5 weight 50.6 shows +0.6 kg at +0.15 kg/week with the +300 kcal prompt; week 5 at 51.2 shows “On track”.
- [ ] The measurements panel appears only in weeks 1, 4, 8 and 12, with week 1 values as placeholders from week 4 on.
- [ ] Edits survive a reload and appear on a second device signed in as the same user.
- [ ] Typing quickly in one field never loses characters or jumps the cursor.
- [ ] Another user cannot read or write this user's rows.
- [ ] Imported data from the old log matches the old page for three sample weeks.
- [ ] Unit tests cover all six functions in `rules.ts`, including empty and partial sets.
