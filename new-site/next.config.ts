import type { NextConfig } from "next";
import os from "os";
import path from "path";

/** LAN IPs so HMR works when opening the app as http://192.168.x.x:3000 */
function lanDevOrigins(): string[] {
  const hosts = new Set<string>(["127.0.0.1", "localhost"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) hosts.add(addr.address);
    }
  }
  return [...hosts];
}

const emptyPolyfill = "./src/lib/empty-polyfill.js";

const buildId =
  process.env.NETLIFY_DEPLOY_ID ||
  process.env.DEPLOY_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "local-dev";

const nextConfig: NextConfig = {
  allowedDevOrigins: lanDevOrigins(),
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  experimental: {
    // Inline route CSS in HTML to remove render-blocking stylesheet chains on first paint.
    inlineCss: true,
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  turbopack: {
    resolveAlias: {
      "../build/polyfills/polyfill-module": emptyPolyfill,
      "next/dist/build/polyfills/polyfill-module": emptyPolyfill,
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "../build/polyfills/polyfill-module": path.resolve(__dirname, emptyPolyfill),
      "next/dist/build/polyfills/polyfill-module": path.resolve(__dirname, emptyPolyfill),
    };
    return config;
  },
  async redirects() {
    return [
      { source: "/stations/edit", destination: "/admin/stations", permanent: false },
      {
        source: "/stations/pending-review",
        destination: "/admin/stations/pending-review",
        permanent: false,
      },
      { source: "/stations/new", destination: "/admin/stations/new", permanent: false },
      {
        source: "/stations/:network/:stationSlug/edit",
        destination: "/admin/stations/:network/:stationSlug/edit",
        permanent: false,
      },
      { source: "/design-system", destination: "/admin/design-system", permanent: false },
      { source: "/design-system/:path*", destination: "/admin/design-system/:path*", permanent: false },
      { source: "/api-status", destination: "/admin/api-status", permanent: false },
    ];
  },
};

export default nextConfig;
