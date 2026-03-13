/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for better-sqlite3 (native Node.js module)
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

export default nextConfig;
