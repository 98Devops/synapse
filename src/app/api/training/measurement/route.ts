import { handleWrite } from '../write';
import { measurementSchema } from '../schemas';

export const dynamic = 'force-dynamic';

/** PUT { runId, week, waist, chest, arm, thigh, photos } — the whole measurement row. */
export async function PUT(req: Request) {
  return handleWrite(req, measurementSchema, (d) => ({ kind: 'measurement', ...d }), true);
}
