import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // ✅ remove old experimental.serverActions (deprecated)
  experimental: {},
  // ✅ make sure Vercel sees your /src/app/api folder
  outputFileTracingRoot: path.join(__dirname, "./"),
  trailingSlash: false,
};

export default nextConfig;
