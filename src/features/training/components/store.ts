'use client';

/**
 * Client state for the training page. Module-level, so unsaved edits and the
 * save queue survive stepping between weeks or leaving the page.
 *
 * Saving: every edit is applied to the in-memory log at once (optimistic),
 * then PUT per field ~500 ms after the last change to that field. Writes for
 * one field run one at a time, in order. Fresh data from the server is
 * merged under any edit that is not yet confirmed, so it never undoes typing.
 * Failed writes are kept (also in localStorage) and retried with backoff.
 */
import { useSyncExternalStore } from 'react';
import { applyOp, dateInZone, emptyCheckin, emptyEntry, emptySession, opKey } from '../rules';
import type { CheckIn, ExerciseLog, Measurement, RunLog, SessionLog, TrainingOp, WeekPayload } from '../types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface TrainingState {
  phase: 'loading' | 'ready' | 'error';
  /** Load error; with a cached payload the page still renders. */
  loadError: string | null;
  payload: WeekPayload | null;
  week: number;
  save: SaveState;
  saveError: string | null;
}

const DEBOUNCE_MS = 500;
const CACHE_PREFIX = 'synapse-training:v1:week:';
const PENDING_KEY = 'synapse-training:v1:pending';

const INITIAL: TrainingState = {
  phase: 'loading',
  loadError: null,
  payload: null,
  week: 1,
  save: 'idle',
  saveError: null,
};

let state: TrainingState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<TrainingState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useTraining(): TrainingState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => INITIAL
  );
}

export const getTrainingState = () => state;

// ================================================================== cache
function readCache(key: string | number): WeekPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as WeekPayload) : null;
  } catch {
    return null;
  }
}

let cacheTimer: ReturnType<typeof setTimeout> | null = null;
function writeCache(keys: (string | number)[] = [state.week]) {
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    const p = state.payload;
    if (!p) return;
    try {
      for (const k of keys) localStorage.setItem(CACHE_PREFIX + k, JSON.stringify({ ...p, week: state.week }));
    } catch {
      // storage full or blocked; the server copy is the source of truth
    }
  }, 250);
}

// ============================================================= save queue
interface Queued {
  op: TrainingOp;
  seq: number;
}

let seq = 0;
const queued = new Map<string, Queued>(); // waiting for the debounce
const inflight = new Map<string, Queued>(); // sent, no answer yet
const failed = new Map<string, Queued>(); // transient failure, will retry
const recent: (Queued & { doneAt: number })[] = []; // confirmed lately
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const chains = new Map<string, Promise<void>>();
let savedOnce = false;
let permanentError: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;

const URL_FOR: Record<TrainingOp['kind'], string> = {
  set: '/api/training/set',
  entry: '/api/training/entry',
  session: '/api/training/session',
  checkin: '/api/training/checkin',
  measurement: '/api/training/measurement',
};

function bodyFor(op: TrainingOp) {
  const { kind: _kind, ...rest } = op;
  return rest;
}

function persistPending() {
  try {
    const ops = [...queued.values(), ...inflight.values(), ...failed.values()].sort((a, b) => a.seq - b.seq);
    if (ops.length) localStorage.setItem(PENDING_KEY, JSON.stringify(ops.map((q) => q.op)));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function updateSaveStatus() {
  if (failed.size) setState({ save: 'offline', saveError: null });
  else if (queued.size || inflight.size) setState({ save: 'saving' });
  else if (permanentError) setState({ save: 'error', saveError: permanentError });
  else setState({ save: savedOnce ? 'saved' : 'idle', saveError: null });
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryNow();
  }, retryDelay);
  retryDelay = Math.min(30000, retryDelay * 2);
}

/** Re-sends everything that failed. Bound to the "Retry" button and the online event. */
export function retryNow() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const [k, q] of [...failed.entries()].sort((a, b) => a[1].seq - b[1].seq)) {
    failed.delete(k);
    if (!queued.has(k)) queued.set(k, q);
    flush(k);
  }
  updateSaveStatus();
}

function flush(k: string) {
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
  const q = queued.get(k);
  if (!q) return;
  queued.delete(k);
  const prev = chains.get(k) ?? Promise.resolve();
  const next = prev.then(() => send(k, q));
  chains.set(k, next);
  void next.finally(() => {
    if (chains.get(k) === next) chains.delete(k);
  });
}

async function send(k: string, q: Queued) {
  inflight.set(k, q);
  updateSaveStatus();
  let transient = false;
  try {
    const res = await fetch(URL_FOR[q.op.kind], {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(q.op)),
    });
    if (res.ok) {
      savedOnce = true;
      permanentError = null;
      retryDelay = 2000;
      recent.push({ ...q, doneAt: Date.now() });
      while (recent.length > 200) recent.shift();
    } else if (res.status >= 500 || res.status === 408 || res.status === 429) {
      transient = true;
    } else {
      const data = await res.json().catch(() => ({}));
      permanentError =
        res.status === 401 ? 'Signed out — sign in again to save.' : (data.error ?? `Save failed (${res.status})`);
    }
  } catch {
    transient = true; // network down
  } finally {
    inflight.delete(k);
  }
  // A newer edit to the same field supersedes this one; no need to retry it.
  if (transient && !queued.has(k)) {
    failed.set(k, q);
    scheduleRetry();
  }
  persistPending();
  updateSaveStatus();
}

/** Ops not yet confirmed, plus ones confirmed after `since`, in edit order. */
function unconfirmed(since: number): TrainingOp[] {
  return [
    ...recent.filter((r) => r.doneAt >= since),
    ...failed.values(),
    ...inflight.values(),
    ...queued.values(),
  ]
    .sort((a, b) => a.seq - b.seq)
    .map((q) => q.op);
}

/** Optimistic edit + debounced save. */
export function edit(op: TrainingOp) {
  const p = state.payload;
  if (!p) return;
  setState({ payload: { ...p, log: applyOp(p.log, op) } });
  writeCache();

  const k = opKey(op);
  failed.delete(k);
  queued.set(k, { op, seq: ++seq });
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.set(k, setTimeout(() => flush(k), DEBOUNCE_MS));
  persistPending();
  updateSaveStatus();
}

/** Sends any debounced edits right away (page hide / unload). */
export function flushAll() {
  for (const k of [...queued.keys()]) flush(k);
}

// ===================================================== edit helpers
// They read the latest state, never a component's possibly stale props.
const runId = () => state.payload?.run?.id ?? '';
const weekLog = (w: number) => state.payload?.log[w];
const sessionAt = (w: number, slot: number): SessionLog => weekLog(w)?.sessions[slot] ?? emptySession();
const entryAt = (w: number, slot: number, key: string): ExerciseLog =>
  sessionAt(w, slot).ex[key] ?? emptyEntry();

export function editSet(week: number, slot: number, key: string, index: number, side: 'left' | 'right', value: number | null) {
  const e = entryAt(week, slot, key);
  const reps = side === 'left' ? value : (e.reps[index] ?? null);
  const repsRight = side === 'right' ? value : (e.repsRight[index] ?? null);
  edit({ kind: 'set', runId: runId(), week, slot, key, index, reps, repsRight });
}

export function editEntry(week: number, slot: number, key: string, patch: Partial<Pick<ExerciseLog, 'load' | 'variation'>>) {
  const e = entryAt(week, slot, key);
  edit({
    kind: 'entry',
    runId: runId(),
    week,
    slot,
    key,
    load: 'load' in patch ? (patch.load ?? null) : e.load,
    variation: 'variation' in patch ? (patch.variation ?? null) : e.variation,
  });
}

export function editSession(week: number, slot: number, patch: Partial<Pick<SessionLog, 'date' | 'done'>>) {
  const s = sessionAt(week, slot);
  const done = patch.done ?? s.done;
  // Ticking Done on an undated session dates it today.
  const date = 'date' in patch ? (patch.date ?? null) : s.date ?? (patch.done ? dateInZone() : null);
  edit({ kind: 'session', runId: runId(), week, slot, date, done });
}

export function editCheckin(week: number, patch: Partial<CheckIn>) {
  const c = weekLog(week)?.checkin ?? emptyCheckin();
  edit({ kind: 'checkin', runId: runId(), week, ...c, ...patch });
}

export function editMeasurement(week: number, patch: Partial<Measurement>) {
  const m = weekLog(week)?.measurement ?? { waist: null, chest: null, arm: null, thigh: null, photos: false };
  edit({ kind: 'measurement', runId: runId(), week, ...m, ...patch });
}

/** Applies several edits at once (voice logging confirmation). */
export function editMany(ops: ((runId: string) => TrainingOp)[]) {
  for (const make of ops) edit(make(runId()));
}

// ================================================================= loading
let loadSeq = 0;
let lastLoadAt = 0;
let restored = false;

function restorePending() {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const ops = raw ? (JSON.parse(raw) as TrainingOp[]) : [];
    for (const op of ops) failed.set(opKey(op), { op, seq: ++seq });
  } catch {
    /* ignore */
  }
  window.addEventListener('online', retryNow);
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
    else if (state.payload && Date.now() - lastLoadAt > 10000) void load(state.week);
  });
  if (failed.size) retryNow();
}

function withUnconfirmed(p: WeekPayload, since: number): WeekPayload {
  let log: RunLog = p.log;
  const run = p.run?.id;
  for (const op of unconfirmed(since)) if (op.runId === run) log = applyOp(log, op);
  return { ...p, log };
}

/**
 * Renders from the local cache at once, then refreshes from the API. `week`
 * is a number, or 'current' to open on the run's current week.
 */
export async function load(week: number | 'current') {
  restorePending();
  const id = ++loadSeq;
  const startedAt = Date.now();
  lastLoadAt = startedAt;

  if (!state.payload) {
    const cached = readCache(week);
    if (cached) {
      setState({
        payload: withUnconfirmed(cached, 0),
        week: week === 'current' ? cached.current.week : week,
        phase: 'ready',
      });
    }
  } else if (week !== 'current') {
    setState({ week });
  }

  try {
    const res = await fetch(`/api/training/week/${week}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Loading failed (${res.status})`);
    if (id !== loadSeq) return; // a newer load superseded this one
    const fresh = data as WeekPayload;
    const viewing = week === 'current' ? fresh.week : week;
    setState({ payload: withUnconfirmed(fresh, startedAt), week: viewing, phase: 'ready', loadError: null });
    writeCache(week === 'current' ? ['current', viewing] : [viewing]);
  } catch (err) {
    if (id !== loadSeq) return;
    const message = navigator.onLine === false ? 'Offline — showing your last copy.' : (err as Error).message;
    setState(state.payload ? { loadError: message } : { phase: 'error', loadError: message });
  }
}

/** Switch the viewed week without a round trip blocking the render. */
export function goToWeek(week: number) {
  setState({ week });
  writeCache([week]);
  void load(week);
}

export function hasRun() {
  return !!state.payload?.run;
}
