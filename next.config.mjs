/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Required for better-sqlite3 (native Node.js module)
    serverComponentsExternalPackages: ['better-sqlite3'],
    // Enables instrumentation.ts at the repo root, which boots the auto-discovery scheduler.
    instrumentationHook: true,
  },
};

export default nextConfig;
