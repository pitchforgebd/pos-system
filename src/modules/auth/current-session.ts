import { cookies } from "next/headers";
import { cache } from "react";

import { SESSION_COOKIE } from "@/modules/auth/constants";
import { loadSession } from "@/modules/auth/session";

export const getSession = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return loadSession(token);
});
