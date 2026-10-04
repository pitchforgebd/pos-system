import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { plannedSections } from "@/constants/navigation";
import { decidePageAccess } from "@/modules/access/route-access";
import { SESSION_COOKIE } from "@/modules/auth/constants";
import { loadSession } from "@/modules/auth/session";
import { concreteScreenPaths, resolveScreen } from "@/lib/screens/registry";

const knownSections = new Set<string>([
  "dashboard",
  "missing",
  "login",
  "forgot-password",
  "reset-password",
  ...Object.keys(plannedSections),
]);

const openPaths = new Set(["/dashboard", "/missing", "/login", "/forgot-password", "/reset-password"]);
const concretePaths = new Set(concreteScreenPaths());

const missingDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not found · Meridian</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6f8;color:#172033;font-family:Segoe UI,sans-serif">
  <main style="max-width:28rem;padding:2rem;text-align:center">
    <h1 style="margin:0;font-size:1.25rem">Page not found</h1>
    <p style="color:#5c6b7a">That screen is not part of this application.</p>
    <p><a href="/dashboard" style="color:#123a63">Back to dashboard</a></p>
  </main>
</body>
</html>`;

const forbiddenDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Permission required · Meridian</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6f8;color:#172033;font-family:Segoe UI,sans-serif">
  <main style="max-width:28rem;padding:2rem;text-align:center">
    <h1 style="margin:0;font-size:1.25rem">Permission required</h1>
    <p style="color:#5c6b7a">Your account cannot open this screen.</p>
    <p><a href="/dashboard" style="color:#123a63">Back to dashboard</a></p>
  </main>
</body>
</html>`;

const liveDetail = /^\/(purchases|suppliers|sales|customers|quotations|requisitions|shifts)\/[0-9a-f-]{36}$|^\/accounting\/journals\/[0-9a-f-]{36}$/i;

function isKnownScreen(pathname: string) {
  if (openPaths.has(pathname) || concretePaths.has(pathname) || liveDetail.test(pathname)) {
    return true;
  }
  const match = resolveScreen(pathname.split("/").filter(Boolean));
  return Boolean(match && !(match.spec.kind === "detail" && !match.record));
}

const publicPaths = new Set(["/login", "/forgot-password", "/reset-password", "/api/health"]);

function continueWithPath(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return continueWithPath(request);
  }
  if (pathname === "/") {
    return continueWithPath(request);
  }
  const segment = pathname.split("/").filter(Boolean)[0];
  const known = Boolean(segment && knownSections.has(segment) && isKnownScreen(pathname));
  if (!known) {
    return new NextResponse(missingDocument, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const isPublic = publicPaths.has(pathname);
  if (isPublic) {
    return continueWithPath(request);
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return loginRedirect(request);
  }
  const session = await loadSession(token);
  if (!session) {
    return loginRedirect(request);
  }
  if (decidePageAccess(pathname, session.permissions) === "forbidden") {
    return new NextResponse(forbiddenDocument, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return continueWithPath(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon|favicon.ico).*)"],
};
