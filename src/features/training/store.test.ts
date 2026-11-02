import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIZE_BLUEPRINT } from './program';
import type { WeekPayload } from './types';

const RUN = '00000000-0000-0000-0000-000000000001';

const payload = (log: WeekPayload['log'] = {}): WeekPayload => ({
  run: { id: RUN, startDate: '2026-10-20', programId: 'p' },
  program: SIZE_BLUEPRINT,
  current: { week: 1, complete: false },
  week: 1,
  log,
});

interface Call {
  url: string;
  method: string;
  body: any;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

let calls: Call[];

/** fetch that parks every request until the test answers it. */
function installFetch() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, resolve, reject });
        })
    )
  );
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const puts = () => calls.filter((c) => c.method === 'PUT');

async function freshStore() {
  vi.resetModules();
  const store = await import('./components/store');
  const loading = store.load(1);
  const get = calls.find((c) => c.method === 'GET')!;
  get.resolve(json(payload()));
  await loading;
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  installFetch();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('window', { addEventListener: () => {} });
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('training store saving', () => {
  it('applies edits at once and debounces one PUT per field with the latest value', async () => {
    const store = await freshStore();
    store.editSet(1, 0, 'pushups', 0, 'left', 1);
    store.editSet(1, 0, 'pushups', 0, 'left', 12);
    expect(store.getTrainingState().payload!.log[1].sessions[0].ex.pushups.reps).toEqual([12]);
    expect(store.getTrainingState().save).toBe('saving');

    await vi.advanceTimersByTimeAsync(499);
    expect(puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(puts()).toHaveLength(1);
    expect(puts()[0]).toMatchObject({ url: '/api/training/set', body: { runId: RUN, week: 1, slot: 0, key: 'pushups', index: 0, reps: 12, repsRight: null } });

    puts()[0].resolve(json({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getTrainingState().save).toBe('saved');
  });

  it('keeps fields independent and serializes writes to the same field', async () => {
    const store = await freshStore();
    store.editSet(1, 0, 'pushups', 0, 'left', 12);
    store.editSet(1, 0, 'pushups', 1, 'left', 10);
    await vi.advanceTimersByTimeAsync(500);
    expect(puts()).toHaveLength(2); // two fields, two writes

    store.editSet(1, 0, 'pushups', 0, 'left', 13);
    await vi.advanceTimersByTimeAsync(500);
    expect(puts()).toHaveLength(2); // waits for the first write of that field

    puts()[0].resolve(json({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(puts()).toHaveLength(3);
    expect(puts()[2].body).toMatchObject({ index: 0, reps: 13 });
  });

  it('sends the whole check-in so fields never blank each other', async () => {
    const store = await freshStore();
    store.editCheckin(1, { weight: 50 });
    store.editCheckin(1, { sleep: 7.5 });
    await vi.advanceTimersByTimeAsync(500);
    expect(puts()).toHaveLength(1);
    expect(puts()[0].body).toEqual({ runId: RUN, week: 1, weight: 50, sleep: 7.5, food: null, notes: null });
  });

  it('never lets fresh server data undo an unsaved edit', async () => {
    const store = await freshStore();
    store.editSet(1, 0, 'pushups', 0, 'left', 12);
    const reload = store.load(1);
    calls.filter((c) => c.method === 'GET').at(-1)!.resolve(json(payload())); // server has nothing yet
    await reload;
    expect(store.getTrainingState().payload!.log[1].sessions[0].ex.pushups.reps).toEqual([12]);
  });

  it('keeps a confirmed edit when a fetch that started before it returns stale data', async () => {
    const store = await freshStore();
    const reload = store.load(1); // started before the edit is confirmed
    store.editSet(1, 0, 'pushups', 0, 'left', 12);
    await vi.advanceTimersByTimeAsync(500);
    puts()[0].resolve(json({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    calls.filter((c) => c.method === 'GET').at(-1)!.resolve(json(payload()));
    await reload;
    expect(store.getTrainingState().payload!.log[1].sessions[0].ex.pushups.reps).toEqual([12]);
  });

  it('goes offline on network failure and retries until saved', async () => {
    const store = await freshStore();
    store.editEntry(1, 0, 'pushups', { load: 2 });
    await vi.advanceTimersByTimeAsync(500);
    puts()[0].reject(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getTrainingState().save).toBe('offline');
    expect(localStorage.getItem('synapse-training:v1:pending')).toContain('"load":2');

    await vi.advanceTimersByTimeAsync(2000); // backoff
    expect(puts()).toHaveLength(2);
    puts()[1].resolve(json({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getTrainingState().save).toBe('saved');
    expect(localStorage.getItem('synapse-training:v1:pending')).toBeNull();
  });

  it('reports validation errors without retrying', async () => {
    const store = await freshStore();
    store.editCheckin(1, { weight: 50 });
    await vi.advanceTimersByTimeAsync(500);
    puts()[0].resolve(json({ error: 'weight: weight must be at least 30' }, 400));
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getTrainingState().save).toBe('error');
    expect(store.getTrainingState().saveError).toContain('at least 30');
    expect(puts()).toHaveLength(1);
  });
});
