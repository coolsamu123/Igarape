import { buildDrivePanelState } from '@/lib/drive-panel-state';

// Server-Sent Events endpoint that pushes a unified DrivePanelState payload
// whenever it changes. Replaces the client-side polling on /api/drive,
// /api/auto-discovery and /api/auto-discovery/stats.
//
// On connect: sends the current snapshot once, then ticks every TICK_MS.
// Only sends new payloads when the JSON differs from the previously sent one.
// During an active pipeline run we tick faster so counters stay live.

const TICK_FAST_MS = 1000;
const TICK_SYNC_MS = 500;   // Faster while Sync-all is active so per-row bars feel live.
const TICK_IDLE_MS = 2000;  // Snappy enough that starting Sync-all reflects within ~2s.

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  let cancelled = false;
  let lastPayload = '';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (cancelled) return;
        const chunk =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cancelled = true;
        }
      };

      const tick = () => {
        if (cancelled) return;
        try {
          const state = buildDrivePanelState();
          const json = JSON.stringify(state);
          if (json !== lastPayload) {
            lastPayload = json;
            send('state', state);
          }
          const syncActive = state.syncAll.status === 'running' || state.syncAll.status === 'stopping';
          const delay = syncActive ? TICK_SYNC_MS : state.pipeline.isRunning ? TICK_FAST_MS : TICK_IDLE_MS;
          setTimeout(tick, delay);
        } catch (err) {
          send('error', { message: err instanceof Error ? err.message : 'tick failed' });
          setTimeout(tick, TICK_IDLE_MS);
        }
      };

      // Initial snapshot + heartbeat comment so proxies don't buffer.
      send('hello', { ok: true });
      tick();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
