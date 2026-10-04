import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requireSession } from "@/modules/access/guard";

const bodySchema = z.object({ lang: z.enum(["bn", "en"]) });

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Choose English or Bangla.", 400);
  }
  const response = jsonOk({ lang: parsed.data.lang });
  response.headers.append("set-cookie", `meridian_lang=${parsed.data.lang}; Path=/; SameSite=Lax`);
  return response;
}
