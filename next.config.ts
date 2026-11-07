import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security/headers";

// Shared hosting limits threads per account. Set NEXT_BUILD_CPUS=1 for `next build` on cPanel
// so the page-data step does not start one worker per server CPU.
const buildCpus = Number(process.env.NEXT_BUILD_CPUS);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(Number.isInteger(buildCpus) && buildCpus > 0 ? { experimental: { cpus: buildCpus } } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.APP_URL) }];
  },
};

export default nextConfig;
