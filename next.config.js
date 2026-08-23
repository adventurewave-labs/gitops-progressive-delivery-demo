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
  // /showcase used to be an app route that redirected to
  // process.env.URL ?? "http://localhost:3000", so every deployed visitor was
  // sent to their own machine. Rewrite to the static file instead.
  async rewrites() {
    return [{ source: "/showcase", destination: "/showcase/index.html" }];
  },

  // The dashboard at / needs a live k3s cluster on the same host — the
  // Codespace flow (setup.sh -> dev-real.sh) serves it from localhost:3000
  // against a real cluster, and that path must keep showing the live
  // dashboard. Vercel never has a cluster, so / is honestly empty there
  // (NoCluster in src/app/page.tsx) — send Vercel visitors straight to the
  // recorded showcase instead.
  //
  // VERCEL is a build-time system env var Vercel always sets to "1"; this
  // config function only runs at build time, so gating on it here (as
  // opposed to gating rendering on it at request time) is safe: dev-real.sh
  // never sets VERCEL, so its build never gets this redirect, and every
  // Vercel build always does. A `next.config.js` *rewrite* to a static file
  // was tried here before and didn't take over the existing page.tsx route;
  // a `redirect` sends the browser a real 307 instead, so it doesn't
  // collide with that route being matched first.
  async redirects() {
    if (process.env.VERCEL !== "1") return [];
    return [
      { source: "/", destination: "/showcase/index.html", permanent: false },
    ];
  },
};

module.exports = nextConfig;
