import type { NextConfig } from "next";

// Static export only (TASK-web-shell-and-data-hooks.md §2.1): readers never touch our
// compute (invariant 5), so there is no server, ISR, rewrites or image optimization.
// Cache Components / partial prefetching (create-next-app defaults) are off: one route,
// no server to stream from.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactCompiler: true,
  trailingSlash: false,
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
