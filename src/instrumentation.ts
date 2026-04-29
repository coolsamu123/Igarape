// Next.js calls this once when the server boots (both dev and prod).
// Used to start the auto-discovery scheduler.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run on the Node.js runtime (skip Edge/Middleware contexts)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSchedulerOnce } = await import('./lib/scheduler');
    startSchedulerOnce();
  }
}
