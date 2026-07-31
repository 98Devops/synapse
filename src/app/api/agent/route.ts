import { NextResponse } from 'next/server';
import { HumanMessage } from 'langchain';
import { createSynapseAgent } from '@/lib/agent/agent';
import { saveConversation } from '@/lib/db/notes';
import { scrollNotes } from '@/lib/qdrant';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';
import type { ToolTrace } from '@/lib/agent/tools';
import type { AgentEvent } from '@/lib/protocol';
import type { Citation } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Streams newline-delimited JSON events so the UI can show the agent thinking. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { query } = await req.json();
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'query (string) is required' }, { status: 400 });
    }

    const question = query.trim();
    const trace: ToolTrace = { touchedNotes: new Set() };
    const agent = createSynapseAgent(trace, user.id);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: AgentEvent) =>
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        const announced = new Set<string>();
        const toolsUsed: string[] = [];
        let answer = '';
        let citations: Citation[] = [];

        try {
          const events = await agent.stream(
            { messages: [new HumanMessage(question)] },
            { streamMode: ['messages', 'updates'] }
          );

          for await (const chunk of events) {
            const [mode, payload] = chunk as [string, any];

            if (mode === 'messages') {
              const [msg] = payload as [any, unknown];
              for (const call of msg?.tool_calls ?? []) {
                if (call?.name && !announced.has(call.name)) {
                  announced.add(call.name);
                  toolsUsed.push(call.name);
                  send({ type: 'tool', name: call.name, args: call.args ?? {} });
                }
              }
              for (const c of msg?.tool_call_chunks ?? []) {
                if (c?.name && !announced.has(c.name)) {
                  announced.add(c.name);
                  toolsUsed.push(c.name);
                  send({ type: 'tool', name: c.name, args: {} });
                }
              }
              const text =
                typeof msg?.content === 'string'
                  ? msg.content
                  : Array.isArray(msg?.content)
                    ? msg.content.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
                    : '';
              if (text && msg?.getType?.() !== 'tool') {
                answer += text;
                send({ type: 'token', text });
              }
            }

            if (mode === 'updates') {
              for (const [node, value] of Object.entries(payload ?? {})) {
                if (node !== 'tools') continue;
                for (const m of (value as any)?.messages ?? []) {
                  if (m?.name) send({ type: 'tool_done', name: m.name });
                }
              }
            }
          }

          const ids = [...trace.touchedNotes];
          if (ids.length) {
            const points = await scrollNotes(user.id, false);
            const byId = new Map(points.map((p) => [p.id, p.payload]));
            citations = ids
              .filter((id) => byId.has(id))
              .map((id) => ({ id, title: byId.get(id)!.title, score: 0 }));
            send({ type: 'citations', citations });
          }
          send({ type: 'done' });
        } catch (err) {
          send({ type: 'error', message: (err as Error).message });
        } finally {
          controller.close();
          // Logged after the stream closes so it never delays the reply.
          if (answer.trim()) {
            saveConversation(user.id, { query: question, answer, citations, tools: toolsUsed });
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    return fail(err);
  }
}
