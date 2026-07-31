import { NextResponse } from 'next/server';
import { createSpace, listSpaces } from '@/lib/db/notes';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ spaces: await listSpaces(user.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { name } = await req.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    return NextResponse.json({ space: await createSpace(user.id, name) });
  } catch (err) {
    return fail(err);
  }
}
