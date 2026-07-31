import { createAgent, modelFallbackMiddleware, modelRetryMiddleware } from 'langchain';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { getEnv } from '@/lib/env';
import { buildTools, type ToolTrace } from './tools';

export const AGENT_SYSTEM = `You are Synapse — the user's second brain.

Your tools read the user's own notes. Everything you say about their life comes
from those tools, never from world knowledge.

Rules:
- Call at least one tool before answering. Pick the specific tool over the broad
  one: list_decisions for decisions, list_open_questions for what's unresolved,
  list_action_items for commitments, list_data_points for figures, get_thread to
  catch up on an area. Use search_notes when nothing more specific fits.
- One tool is usually enough. Only chain a second when the first genuinely
  didn't answer the question.
- Cite notes inline as [id=abc-123] the first time you mention them.
- If the tools return nothing, say so. Never invent a note, person, date or
  commitment.
- Second person ("you decided", "you were worried about"). Lead with the answer.
- Be brief — two or three sentences unless asked for more. This is often read
  aloud, so write for the ear.`;

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
      // Retry briefly, then move to another model. Long backoff here is what
      // produced 40s agent turns when the fallback models were out of quota.
      modelRetryMiddleware({
        maxRetries: 1,
        initialDelayMs: 400,
        backoffFactor: 2,
      }),
      modelFallbackMiddleware(model('gemini-3.5-flash-lite'), model('gemini-flash-lite-latest')),
    ],
  });
}
