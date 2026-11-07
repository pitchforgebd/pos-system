import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // server.js is the CommonJS startup file for cPanel (Passenger).
    files: ["server.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Product photos and the shop logo come from authenticated API routes. The next/image
    // optimizer fetches on the server without the session cookie, so plain <img> is intended.
    rules: { "@next/next/no-img-element": "off" },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "storage/**",
    "meridian-backups/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "docs/**",
    "advanced_pos_erp_master_blueprint.md",
  ]),
]);

export default eslintConfig;
