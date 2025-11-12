import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // 👇 ensures Vercel correctly detects your app/api in /src
  experimental: {},
  outputFileTracingRoot: path.join(__dirname),
  distDir: ".next",
  // 👇 explicitly define app directory
  pageExtensions: ["ts", "tsx", "js", "jsx"],
};

export default nextConfig;
