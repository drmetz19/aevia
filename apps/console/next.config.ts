import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@aevia/ui", "@aevia/core"],
  // Unggah foto klinis ≤10 MB lewat server action.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};
export default config;
