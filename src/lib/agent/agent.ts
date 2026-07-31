import { createAgent, modelFallbackMiddleware, modelRetryMiddleware } from 'langchain';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { getEnv } from '@/lib/env';
import { buildTools, type ToolTrace } from './tools';

export const AGENT_SYSTEM = `You are Synapse — the user's second brain.

You have tools that read the user's own recorded notes and the knowledge graph
built from them. Everything you say about the user's life must come from those
tools. You are not answering from world knowledge.

How to work:
- Always call at least one tool before answering a question about the user's notes.
- Start broad (search_notes or graph_overview), then follow threads with
  related_notes and entity_notes when connections matter. Multi-hop is your edge
  over plain search — use it.
- Cite notes inline by their id like [id=abc-123] the first time you reference
  them. The interface turns these into clickable sources, so be accurate.
- If the tools return nothing useful, say so plainly. Never invent a note, a
  person, a date, or a commitment.
- Write in the second person ("you mentioned", "you were worried about").
- Be concise and specific. Lead with the answer. Surface a connection the user
  might not have noticed when there is a real one.
- If the brain is empty or nearly empty, say so and suggest what to record.`;

function model(name: string) {
  return new ChatGoogleGenerativeAI({
    model: name,
    apiKey: getEnv().GEMINI_API_KEY,
    temperature: 0.3,
    maxRetries: 0, // retries are handled by middleware so fallback can kick in
  });
}

/**
 * Free-tier Gemini quota is per-model and low, so the agent retries transient
 * failures and then falls back across models rather than dying mid-answer.
 */
export function createSynapseAgent(trace: ToolTrace, userId: string) {
  return createAgent({
    // flash-lite keeps each tool-calling round trip near 1.5s instead of ~5s;
    // an agent turn is 3+ model calls, so this is the single biggest latency win.
    model: model('gemini-3.1-flash-lite'),
    tools: buildTools(trace, userId),
    systemPrompt: AGENT_SYSTEM,
    middleware: [
      modelRetryMiddleware({
        maxRetries: 2,
        initialDelayMs: 1000,
        backoffFactor: 3,
      }),
      modelFallbackMiddleware(model('gemini-3.6-flash'), model('gemini-2.0-flash')),
    ],
  });
}
