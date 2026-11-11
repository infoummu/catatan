/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image produksi ringan: server mandiri (dipakai Dockerfile)
  output: "standalone",
  serverExternalPackages: ['better-sqlite3'],
};

module.exports = nextConfig;
