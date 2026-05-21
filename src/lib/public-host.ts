// Single source of truth for "is this request coming from a public host?".
// Used by both the root layout (UI gating) and API routes (action gating)
// so the rule stays in sync.
//
// Default matches Cloudflare quick-tunnel domains. Override with
// PUBLIC_HOSTS=foo.com,bar.com (comma-separated substring match).

export function isPublicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const patterns = (process.env.PUBLIC_HOSTS || 'trycloudflare.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const h = host.toLowerCase();
  return patterns.some(p => h.includes(p));
}
