import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Ensure the API routes run on the server (not static)
  output: undefined, // make sure it’s NOT 'export'
};

export default nextConfig;
