import { handleWrite } from '../write';
import { checkinSchema } from '../schemas';

export const dynamic = 'force-dynamic';

/** PUT { runId, week, weight, sleep, food, notes } — the whole check-in row. */
export async function PUT(req: Request) {
  return handleWrite(req, checkinSchema, (d) => ({ kind: 'checkin', ...d }), true);
}
