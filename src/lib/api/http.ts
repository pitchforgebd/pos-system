export function jsonOk(
  data: unknown,
  message = "Operation completed",
  status = 200,
  meta: Record<string, unknown> = {},
) {
  return Response.json({ success: true, data, message, meta }, { status });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  fields: Record<string, string> = {},
) {
  return Response.json({ success: false, error: { code, message, fields } }, { status });
}

let lastUnknownWarning = 0;

/** When no address can be found every request shares the "unknown" address (and its own, higher limit); say so in the log, at most every ten minutes (S5). */
function warnUnknownAddress(reason: string) {
  const now = Date.now();
  if (now - lastUnknownWarning > 10 * 60 * 1000) {
    lastUnknownWarning = now;
    console.warn(`client address unknown (${reason}): sign-in limits are shared by everyone on the "unknown" address`);
  }
}

export function clientIp(request: Request) {
  if (process.env.TRUST_PROXY === "1") {
    const parts = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = parts.at(-1);
    if (last) {
      return last.slice(0, 45);
    }
    warnUnknownAddress("TRUST_PROXY=1 but the proxy sent no X-Forwarded-For");
  } else if (process.env.NODE_ENV === "production") {
    warnUnknownAddress("TRUST_PROXY is not 1");
  }
  return "unknown";
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // The forwarded host is the proxy's word: it is read only when the proxy is trusted (S1)
  const forwarded = process.env.TRUST_PROXY === "1" ? request.headers.get("x-forwarded-host") : null;
  const host = forwarded ?? request.headers.get("host") ?? new URL(request.url).host;
  if (!origin || !host) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function rejectCrossSite(request: Request) {
  if (sameOrigin(request)) {
    return null;
  }
  return jsonError("AUTHORIZATION_ERROR", "Request origin was rejected.", 403);
}
