import { handleWrite } from '../write';
import { entrySchema } from '../schemas';

export const dynamic = 'force-dynamic';

/** PUT { runId, week, slot, key, load, variation } — both fields are written each time. */
export async function PUT(req: Request) {
  return handleWrite(req, entrySchema, (d) => ({ kind: 'entry', ...d }));
}
