import { handleWrite } from '../write';
import { setSchema } from '../schemas';

export const dynamic = 'force-dynamic';

/** PUT { runId, week, slot, key, index, reps, repsRight? } — null reps on both sides deletes the set. */
export async function PUT(req: Request) {
  return handleWrite(req, setSchema, (d) => ({ kind: 'set', ...d }));
}
