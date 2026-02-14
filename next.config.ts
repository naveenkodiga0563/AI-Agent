import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  ...(isDev && {
    devIndicators: false,
  }),
};

export default nextConfig;
