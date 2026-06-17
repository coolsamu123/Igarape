// No-op. There is no scheduler, no background work to start at boot.
// Stale auto_runs rows (status='running' left behind by a killed process) are
// healed lazily inside drive-panel-state on the next API poll.

export async function register() {}
