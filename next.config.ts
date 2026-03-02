import type { NextConfig } from "next";

// SAFMR XLSX uploads can exceed 1 MB; allow up to 20 MB for Server Actions
const SAFMR_BODY_LIMIT = 20 * 1024 * 1024;

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: SAFMR_BODY_LIMIT,
    },
  },
};

export default nextConfig;
