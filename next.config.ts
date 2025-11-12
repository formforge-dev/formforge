import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {},
  // 👇 This helps Vercel locate your app/api under /src
  outputFileTracingRoot: path.join(__dirname),
  // 👇 Ensure Next knows "src" is your app directory
  distDir: ".next",
};

export default nextConfig;
