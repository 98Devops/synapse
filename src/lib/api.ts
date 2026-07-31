import { NextResponse } from 'next/server';

/** Turns a thrown error into a response, preserving 401 from requireUser(). */
export function fail(err: unknown) {
  const status = (err as Error & { status?: number })?.status ?? 500;
  return NextResponse.json({ error: (err as Error).message }, { status });
}
