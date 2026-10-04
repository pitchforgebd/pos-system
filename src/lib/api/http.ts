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
  }
  return "unknown";
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
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
