import { register } from "node:module";

// Resolves the "@/" alias for scripts run outside Next.js: `npm test` and `prisma db seed`.
// Keep this file free of checks: the seed runs on real servers. The test-only guard is in guard.mjs.
register("./hooks.mjs", import.meta.url);
