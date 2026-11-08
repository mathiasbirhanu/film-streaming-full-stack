import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The sandbox preview gateway forwards requests with an internal
  // x-forwarded-host (fcapp.run) while the browser origin is *.space-z.ai —
  // Next.js would abort Server Actions on the mismatch. Allow both hosts.
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "*.space-z.ai",
        "*.fcapp.run",
        "*.vpc.fcapp.run",
      ],
    },
  },
};

export default nextConfig;
