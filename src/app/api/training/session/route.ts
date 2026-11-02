import { handleWrite } from '../write';
import { sessionSchema } from '../schemas';

export const dynamic = 'force-dynamic';

/** PUT { runId, week, slot, date, done } */
export async function PUT(req: Request) {
  return handleWrite(req, sessionSchema, (d) => ({ kind: 'session', ...d }));
}
