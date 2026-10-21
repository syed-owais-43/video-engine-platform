import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Shared tools (exporter + its guide) are read from disk at runtime by these routes.
  outputFileTracingIncludes: {
    "/api/mcp": ["./shared/**/*"],
    "/api/bundle/*": ["./shared/**/*"],
  },
  // Engine ZIP uploads from the admin panel go through a Server Action.
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
