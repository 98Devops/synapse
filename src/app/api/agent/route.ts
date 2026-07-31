import { NextResponse } from 'next/server';
import { HumanMessage } from 'langchain';
import { createSynapseAgent } from '@/lib/agent/agent';
import { scrollNotes } from '@/lib/qdrant';
import type { ToolTrace } from '@/lib/agent/tools';
import type { AgentEvent } from '@/lib/protocol';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Streams newline-delimited JSON events so the UI can show the agent thinking. */
export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'query (string) is required' }, { status: 400 });
    }

    const trace: ToolTrace = { touchedNotes: new Set() };
    const agent = createSynapseAgent(trace);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: AgentEvent) =>
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        const announced = new Set<string>();

        try {
          const events = await agent.stream(
            { messages: [new HumanMessage(query.trim())] },
            { streamMode: ['messages', 'updates'] }
          );

          for await (const chunk of events) {
            const [mode, payload] = chunk as [string, any];

            if (mode === 'messages') {
              const [msg] = payload as [any, unknown];
              // Streamed chunks carry tool_call_chunks; only the assembled
              // message has tool_calls. Watch both so the UI updates live.
              for (const call of msg?.tool_calls ?? []) {
                if (call?.name && !announced.has(call.name)) {
                  announced.add(call.name);
                  send({ type: 'tool', name: call.name, args: call.args ?? {} });
                }
              }
              for (const chunk of msg?.tool_call_chunks ?? []) {
                if (chunk?.name && !announced.has(chunk.name)) {
                  announced.add(chunk.name);
                  send({ type: 'tool', name: chunk.name, args: {} });
                }
              }
              const text =
                typeof msg?.content === 'string'
                  ? msg.content
                  : Array.isArray(msg?.content)
                    ? msg.content.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
                    : '';
              if (text && msg?.getType?.() !== 'tool') send({ type: 'token', text });
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

          // Resolve the ids the tools touched into citation titles.
          const ids = [...trace.touchedNotes];
          if (ids.length) {
            const points = await scrollNotes(false);
            const byId = new Map(points.map((p) => [p.id, p.payload]));
            send({
              type: 'citations',
              citations: ids
                .filter((id) => byId.has(id))
                .map((id) => ({ id, title: byId.get(id)!.title, score: 0 })),
            });
          }
          send({ type: 'done' });
        } catch (err) {
          send({ type: 'error', message: (err as Error).message });
        } finally {
          controller.close();
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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
