/**
 * The /api/ask response is a citations JSON header, this delimiter, then the
 * streamed answer text. Shared so the client and route can never disagree.
 */
export const ASK_DELIMITER = '\n\n<<<SYNAPSE>>>\n\n';

import type { Citation } from './types';

/** Newline-delimited JSON events streamed by /api/agent. */
export type AgentEvent =
  | { type: 'tool'; name: string; args: Record<string, unknown> }
  | { type: 'tool_done'; name: string }
  | { type: 'token'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Human-readable labels for the agent's tool calls, shown as it works. */
export const TOOL_LABELS: Record<string, string> = {
  search_notes: 'Searching your notes',
  related_notes: 'Following connections',
  entity_notes: 'Looking up mentions',
  graph_overview: 'Surveying the graph',
  list_action_items: 'Checking action items',
  recent_notes: 'Reading recent notes',
};
