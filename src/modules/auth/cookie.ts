import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/modules/auth/constants";

function serializeCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`;
}

function withCookie(response: Response, cookie: string) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

export function applySessionCookie(response: Response, token: string) {
  return withCookie(response, serializeCookie(token, SESSION_MAX_AGE_SECONDS));
}

export function clearSessionCookie(response: Response) {
  return withCookie(response, serializeCookie("", 0));
}
