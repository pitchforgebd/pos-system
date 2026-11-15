/** The headers every response carries and that do not change from one request to the next. The Content-Security-Policy is made for each request (below). */
export function securityHeaders(appUrl: string | undefined) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  if (appUrl?.startsWith("https://")) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}

/** A new, unguessable value for one request: the policy lets only scripts that carry it run (S11). */
export function newNonce() {
  return btoa(crypto.randomUUID());
}

/**
 * The Content-Security-Policy of one response (S11). Scripts run only when they carry this request's nonce, or were loaded by a script that does
 * ('strict-dynamic'), so a script an attacker manages to put into a page does not run. 'unsafe-eval' is added only while developing (React needs it
 * there). Styles may still be inline: the pages set style attributes, and a style cannot run code.
 */
export function contentSecurityPolicy(nonce: string, development = process.env.NODE_ENV === "development") {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
