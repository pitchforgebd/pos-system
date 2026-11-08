import { prisma } from "@/lib/db/client";
import { defineRoute } from "@/core/http/define-route";
import { jsonError, jsonOk } from "@/lib/api/http";

export const GET = defineRoute({
  public: true,
  handler: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return jsonOk({ status: "ok", database: "ok", version: "0.1.0" });
    } catch {
      return jsonError("DATABASE_ERROR", "The service is unavailable.", 500);
    }
  },
});
