import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { plannedSections } from "@/constants/navigation";
import { decidePageAccess } from "@/modules/access/route-access";
import { SESSION_COOKIE } from "@/modules/auth/constants";
import { contentSecurityPolicy, newNonce } from "@/lib/security/headers";
import { loadSession } from "@/modules/auth/session";

const knownSections = new Set<string>([
  "dashboard",
  "missing",
  "profile",
  "login",
  "forgot-password",
  "reset-password",
  ...Object.keys(plannedSections),
]);


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


const publicPaths = new Set(["/login", "/forgot-password", "/reset-password", "/api/health"]);

/**
 * Every answer of the proxy carries the Content-Security-Policy of this request (S11). The policy is also put on the request, where Next.js reads the
 * nonce from it and puts it on its own scripts while it renders the page: so every page must be rendered for the request, never made at build time.
 */
function policyFor(request: NextRequest) {
  const policy = contentSecurityPolicy(newNonce());
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  return { policy, headers };
}

function continueWithPath(request: NextRequest) {
  const { policy, headers } = policyFor(request);
  headers.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

function withPolicy(request: NextRequest, response: NextResponse) {
  response.headers.set("Content-Security-Policy", policyFor(request).policy);
  return response;
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
  // A path is served when its first segment is a section of the application. Every page below a section is a real page (there are no
  // sample screens any more); a path with no page gets the application's own "not found" from the router.
  const known = Boolean(segment && knownSections.has(segment));
  if (!known) {
    return withPolicy(request, new NextResponse(missingDocument, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
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
    return withPolicy(request, new NextResponse(forbiddenDocument, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
  }
  return continueWithPath(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon|favicon.ico).*)"],
};
