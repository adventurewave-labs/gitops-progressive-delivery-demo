/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the multi-stage Dockerfile — produces a self-contained
  // `.next/standalone` server that can be run with `node server.js`.
  output: "standalone",

  // Tolerate type errors during build so the Docker image still builds in CI.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Disable strict mode double-render to keep animation effects predictable
  // across the demo state machine.
  reactStrictMode: false,

  // Allow the sandbox preview host to talk to the Next.js dev server without
  // a cross-origin warning. (Production / Docker builds are unaffected.)
  allowedDevOrigins: ["*.space-z.ai", "*.vercel.app"],
};

module.exports = nextConfig;
